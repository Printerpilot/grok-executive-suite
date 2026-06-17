const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cron = require('node-cron');
const { runDesktopAction } = require('./lib/desktop-control');
const taskStore = require('./lib/task-store');
const sessionTracker = require('./lib/session-tracker');

const GROK_BIN = path.join(os.homedir(), '.grok', 'bin', 'grok');
const GROK_INSTALL_CMD = 'curl -fsSL https://x.ai/cli/install.sh | bash';

// Ensures dev (`electron .`) appears as "Grok Executive Suite" to macOS automation.
app.setName('Grok Executive Suite');

let mainWindow;
let activeGrokProcess = null;
const scheduledGrokProcesses = new Map();
let activeSessionWatcher = null;

function stopSessionWatcher() {
  if (activeSessionWatcher) {
    try { activeSessionWatcher(); } catch (e) {}
    activeSessionWatcher = null;
  }
}

function notifyTaskSession(task, projectId) {
  mainWindow?.webContents.send('task-session-updated', { task, projectId });
}

function syncTaskSession(project, task) {
  if (!task) return task;
  const updated = sessionTracker.backfillTaskSession(taskStore, DATA_DIR, project, task);
  if (updated) notifyTaskSession(updated, project.id);
  return updated || task;
}

function startSessionWatcher(project, task) {
  stopSessionWatcher();
  if (!task) return;
  activeSessionWatcher = sessionTracker.createSessionWatcher(
    taskStore,
    DATA_DIR,
    project,
    task,
    (updated) => notifyTaskSession(updated, project.id)
  );
}
const DATA_DIR = path.join(os.homedir(), '.grok-cowork');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  // Fresh general state - no specific project baked in
  const defaultState = {
    activeProjectId: 'general',
    projects: [
      {
        id: 'general',
        name: 'General Workspace',
        rootPath: os.homedir(),
        workingFolders: [],
        grokSessionId: null
      }
    ],
    scheduledTasks: [
      {
        id: 'daily-review',
        name: 'Daily project review',
        description: 'Review recent changes, progress, and next steps for the active project.',
        cron: '0 9 * * *',
        enabled: false,
        lastRun: null,
        runs: []
      }
    ],
    dispatches: [
      {
        id: 'investigate-main-issue',
        label: 'Investigate and propose fix for the main current issue',
        projectId: 'general'
      },
      {
        id: 'write-tests',
        label: 'Write or improve tests for recent changes',
        projectId: 'general'
      }
    ],
    progress: {
      'general': [
        { id: 'p1', label: 'Understand current state of the project', done: false },
        { id: 'p2', label: 'Identify next high-value task', done: false },
        { id: 'p3', label: 'Execute or dispatch the task', done: false }
      ]
    },
    connectors: ['github', 'filesystem', 'web-search'],
    actWithoutAsking: true
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(defaultState, null, 2));
  return defaultState;
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const scheduledStreamBuffers = new Map();

function getScheduledTask(id) {
  return state.scheduledTasks.find(t => t.id === id);
}

function hasUnviewedScheduledRuns(task) {
  return (task.runs || []).some(r => r.status !== 'running' && !r.viewed);
}

function ensureScheduledRun(scheduledTaskId, runId) {
  const task = getScheduledTask(scheduledTaskId);
  if (!task) return null;
  task.runs = task.runs || [];
  let run = task.runs.find(r => r.id === runId);
  if (!run) {
    run = {
      id: runId,
      startedAt: new Date().toISOString(),
      status: 'running',
      messages: [],
      viewed: false
    };
    task.runs.unshift(run);
    if (task.runs.length > 50) task.runs = task.runs.slice(0, 50);
  }
  return { task, run };
}

function notifyScheduledRunUpdate(task, run) {
  mainWindow?.webContents.send('scheduled-run-updated', {
    taskId: task.id,
    run,
    hasUnviewed: hasUnviewedScheduledRuns(task)
  });
}

function appendScheduledStreamChunk(scheduledTaskId, runId, role, chunk) {
  const pair = ensureScheduledRun(scheduledTaskId, runId);
  if (!pair || !chunk) return;
  const buf = scheduledStreamBuffers.get(runId) || { thought: '', assistant: '' };
  if (role === 'thought') buf.thought += chunk;
  else buf.assistant += chunk;
  scheduledStreamBuffers.set(runId, buf);
}

function flushScheduledStreamBuffers(scheduledTaskId, runId) {
  const pair = ensureScheduledRun(scheduledTaskId, runId);
  if (!pair) return;
  const { task, run } = pair;
  const buf = scheduledStreamBuffers.get(runId);
  if (buf) {
    if (buf.thought.trim()) run.messages.push({ role: 'thought', content: buf.thought });
    if (buf.assistant.trim()) run.messages.push({ role: 'assistant', content: buf.assistant });
    scheduledStreamBuffers.delete(runId);
  }
  saveState(state);
  notifyScheduledRunUpdate(task, run);
}

function finalizeScheduledRun(scheduledTaskId, runId, { code = 0, stopped = false } = {}) {
  flushScheduledStreamBuffers(scheduledTaskId, runId);
  const pair = ensureScheduledRun(scheduledTaskId, runId);
  if (!pair) return;
  const { task, run } = pair;
  run.status = stopped ? 'stopped' : (code === 0 ? 'completed' : 'failed');
  run.completedAt = new Date().toISOString();
  run.viewed = false;
  task.lastRun = run.completedAt;
  saveState(state);
  notifyScheduledRunUpdate(task, run);
}

function sendGrokEvent(ev, { scheduledTaskId, runId } = {}) {
  if (scheduledTaskId && runId) {
    mainWindow?.webContents.send('grok-event', {
      ...ev,
      meta: { scheduledTaskId, runId, isolated: true }
    });
  } else {
    mainWindow?.webContents.send('grok-event', ev);
  }
}

async function executeScheduledTask(scheduledTaskId) {
  const task = getScheduledTask(scheduledTaskId);
  if (!task) return { ok: false, error: 'Scheduled task not found' };
  const proj = getActiveProject();
  const runId = 'run-' + Date.now();
  ensureScheduledRun(scheduledTaskId, runId);
  task.lastRun = new Date().toISOString();
  saveState(state);
  const pair = ensureScheduledRun(scheduledTaskId, runId);
  if (pair) notifyScheduledRunUpdate(pair.task, pair.run);
  mainWindow?.webContents.send('scheduled-run-started', { taskId: scheduledTaskId, runId });

  const prompt = `Scheduled task — ${task.name}${task.description ? `: ${task.description}` : ''}`;
  const result = await runGrokWithContext(prompt, proj, { scheduledTaskId, runId });
  finalizeScheduledRun(scheduledTaskId, runId, { code: result?.ok ? 0 : 1, stopped: !!result?.stopped });
  return { ok: true, runId };
}

let state = loadState();
state.scheduledTasks = (state.scheduledTasks || []).map(t => ({ runs: [], ...t, runs: t.runs || [] }));

function getActiveProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
}

function getSetupStatus() {
  const grokInstalled = fs.existsSync(GROK_BIN);
  return {
    grokInstalled,
    grokPath: GROK_BIN,
    grokInstallCmd: GROK_INSTALL_CMD,
    dataDir: DATA_DIR,
    platform: process.platform,
    arch: process.arch,
    appVersion: require('./package.json').version
  };
}

function loadProjectContext(project) {
  const candidates = [
    project.contextFile,
    path.join(DATA_DIR, 'projects', project.id, 'context.md')
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const body = fs.readFileSync(file, 'utf8').trim();
        if (body) return body;
      }
    } catch (e) {}
  }
  return '';
}

function buildContextRules(project, task, { scheduled = false } = {}) {
  const projectFolders = project.workingFolders || [];
  const sessionFolders = task?.sessionFolders || [];
  const mergedFolders = [...new Set([...projectFolders, ...sessionFolders])];
  const wf = mergedFolders.length > 0
    ? mergedFolders.join('\n')
    : '(no additional working folders specified — use the project root)';

  const taskProgress = task?.progress || state.progress[project.id] || [];
  const prog = taskProgress.map(p => `${p.done ? '✅' : '○'} ${p.label}`).join('\n') || 'No progress items yet — create steps with update_goal as you work.';

  const connectors = (task?.sessionConnectors || []).map(c => c.name || c).join(', ') || (state.connectors || []).join(', ') || 'filesystem, terminal';

  const act = state.actWithoutAsking ? 'Act without asking is ON (full autonomy, use --always-approve style behavior when appropriate).' : 'Ask for confirmation on significant actions.';

  const projectContext = loadProjectContext(project);
  const contextBlock = projectContext
    ? `\n\nProject context (read and honor):\n${projectContext}\n`
    : '';

  const taskLine = task?.title ? `\nActive Task: ${task.title} (task id: ${task.id})\n` : '';

  const scheduledBlock = scheduled
    ? '\nThis is an automated scheduled task run. Complete the work autonomously. Output is stored in the scheduled task record only — not the active conversation.\n'
    : '';

  return `You are operating in Grok Executive Suite (a native desktop agent workspace for executive-level AI delegation).

Current Project: ${project.name}
Project Root: ${project.rootPath}
${taskLine}${scheduledBlock}
Working Folders (attach context from these):
${wf}

Current Progress (this task — update continuously via update_goal):
${prog}

Session tools/connectors used so far: ${connectors}

Autonomy mode:
${act}

Use all available capabilities (subagents for parallel work, plan mode for ambiguous tasks, skills, full terminal + file system access, web search, MCP connectors if enabled).

Desktop control (macOS):
- MCP tools from executive-suite-desktop when configured: get_cursor_position, move_cursor, click, type_text, press_key, open_app, focus_app.
- While this app is running, queue batched actions by writing ~/.grok-cowork/desktop-queue.json (processed automatically).
- Desktop screenshot attach: user can Capture Desktop from the app menu or drag-and-drop images into chat.

Setup for parity: users run scripts/setup-grok-parity.sh once to register the desktop MCP and recommended Grok config.

Be proactive: call update_goal to create and check off progress steps as you work. Log folders you read/write via session working folders. Note connectors/tools you use (Shell, WebSearch, desktop control, MCPs).
When you edit files in the working folders, note them for the Artifacts list.${contextBlock}`;
}

function getTaskContext(projectId) {
  taskStore.migrateProjectSession(DATA_DIR, state.projects.find(p => p.id === projectId));
  return taskStore.getActiveTask(DATA_DIR, projectId);
}

function attachmentDir(projectId, taskId) {
  return path.join(DATA_DIR, 'projects', projectId, taskId, 'attachments');
}

function buildAttachmentBlock(attachments = []) {
  if (!attachments.length) return '';
  return '\n\nAttached screenshots (use vision/filesystem tools to read and analyze):\n' +
    attachments.map((a, i) => `${i + 1}. ${a.path}`).join('\n');
}

async function runGrokWithContext(userPrompt, project, { taskId, attachments = [], scheduledTaskId, runId } = {}) {
  const isScheduled = !!(scheduledTaskId && runId);
  let task = null;

  if (!isScheduled) {
    task = taskId
      ? taskStore.switchTask(DATA_DIR, project.id, taskId)
      : getTaskContext(project.id);

    if (!task) {
      task = taskStore.createTask(DATA_DIR, project.id, {
        title: taskStore.titleFromPrompt(userPrompt)
      });
    }
  }

  const rules = buildContextRules(project, task, { scheduled: isScheduled });
  const attachmentBlock = buildAttachmentBlock(attachments);
  const fullPrompt = `${rules}${attachmentBlock}\n\nUser request / dispatch:\n${userPrompt}`;

  return new Promise((resolve, reject) => {
    if (isScheduled) {
      if (scheduledGrokProcesses.has(scheduledTaskId)) {
        try { scheduledGrokProcesses.get(scheduledTaskId).kill('SIGTERM'); } catch (e) {}
        scheduledGrokProcesses.delete(scheduledTaskId);
      }
    } else {
      if (activeGrokProcess) {
        try { activeGrokProcess.kill('SIGTERM'); } catch (e) {}
        activeGrokProcess = null;
      }
    }

    const expandedRoot = project.rootPath.startsWith('~/') ? path.join(os.homedir(), project.rootPath.slice(2)) : project.rootPath;

    if (!fs.existsSync(expandedRoot)) {
      sendGrokEvent({ type: 'error', data: `Project directory does not exist: ${expandedRoot}. Please update your project path.` }, { scheduledTaskId, runId });
      sendGrokEvent({ type: 'end' }, { scheduledTaskId, runId });
      return resolve();
    }

    const args = [
      '-p', fullPrompt,
      '--output-format', 'streaming-json',
      '--cwd', expandedRoot,
      '--rules', rules
    ];

    if (state.actWithoutAsking) {
      args.push('--always-approve');
    }

    if (task.grokSessionId) {
      args.push('--resume', task.grokSessionId);
    }

    console.log('[main] Spawning grok for prompt:', fullPrompt.substring(0, 100) + '...');
    console.log('[main] Using binary:', GROK_BIN);

    const child = spawn(GROK_BIN, args, {
      cwd: expandedRoot,
      env: { ...process.env, PATH: `${path.join(os.homedir(), '.grok', 'bin')}:${process.env.PATH || ''}` }
    });

    if (isScheduled) {
      scheduledGrokProcesses.set(scheduledTaskId, child);
    } else {
      activeGrokProcess = child;
      if (task) startSessionWatcher(project, task);
    }
    sendGrokEvent({ type: 'start' }, { scheduledTaskId, runId });

    let buffer = '';
    let stoppedByUser = false;

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      lines.forEach(line => {
        if (!line.trim()) return;
        try {
          const ev = JSON.parse(line);
          if (isScheduled) {
            const chunk = ev.data || ev.text || ev.thought || '';
            if (ev.type === 'thought' || ev.thought) {
              appendScheduledStreamChunk(scheduledTaskId, runId, 'thought', chunk);
            }
            if (ev.type === 'text' || ev.type === 'assistant_chunk') {
              appendScheduledStreamChunk(scheduledTaskId, runId, 'assistant', chunk);
            }
          }
          sendGrokEvent(ev, { scheduledTaskId, runId });
          if (!isScheduled && ev.sessionId && task && !task.grokSessionId) {
            taskStore.updateTask(DATA_DIR, project.id, task.id, { grokSessionId: ev.sessionId });
            task.grokSessionId = ev.sessionId;
          }
        } catch (e) {
          console.log('[main] Non-JSON stdout:', line);
        }
      });
    });

    let stderrBuffer = '';
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      console.error('[main] grok stderr:', chunk);
      stderrBuffer += chunk;
    });

    child.on('error', (err) => {
      console.error('[main] grok spawn error:', err);
      if (isScheduled) {
        if (scheduledGrokProcesses.get(scheduledTaskId) === child) scheduledGrokProcesses.delete(scheduledTaskId);
      } else {
        if (activeGrokProcess === child) activeGrokProcess = null;
      }
      sendGrokEvent({ type: 'error', data: 'Failed to start grok: ' + (err.message || err) }, { scheduledTaskId, runId });
      sendGrokEvent({ type: 'end' }, { scheduledTaskId, runId });
      reject(err);
    });

    child.on('close', (code) => {
      console.log('[main] grok process closed with code', code);
      if (isScheduled) {
        if (scheduledGrokProcesses.get(scheduledTaskId) === child) scheduledGrokProcesses.delete(scheduledTaskId);
      } else {
        if (activeGrokProcess === child) activeGrokProcess = null;
      }
      stopSessionWatcher();
      if (!isScheduled && task) syncTaskSession(project, task);

      if (code !== 0 && !stoppedByUser) {
        if (stderrBuffer.includes('Session does not exist')) {
          sendGrokEvent({ type: 'error', data: 'Session was corrupted by interruption. Resetting session context. Please try again.' }, { scheduledTaskId, runId });
          if (!isScheduled && task) {
            taskStore.updateTask(DATA_DIR, project.id, task.id, { grokSessionId: null });
            task.grokSessionId = null;
          }
        } else {
          sendGrokEvent({ type: 'error', data: `Grok failed (code ${code}). Check terminal for logs.` }, { scheduledTaskId, runId });
        }
      }

      sendGrokEvent({ type: stoppedByUser ? 'stopped' : 'end' }, { scheduledTaskId, runId });
      resolve({ ok: code === 0, stopped: stoppedByUser });
    });

    child.stderr.on('data', (d) => {
      const msg = d.toString();
      console.error('[main] grok stderr:', msg);
      sendGrokEvent({ type: 'error', data: msg }, { scheduledTaskId, runId });
    });

    child._markStoppedByUser = () => { stoppedByUser = true; };
  });
}

function stopActiveGrok() {
  if (!activeGrokProcess) return { ok: false, error: 'No active Grok process' };
  stopSessionWatcher();
  const child = activeGrokProcess;
  try {
    if (typeof child._markStoppedByUser === 'function') child._markStoppedByUser();
    child.kill('SIGTERM');
    setTimeout(() => {
      if (activeGrokProcess === child) {
        try { child.kill('SIGKILL'); } catch (e) {}
      }
    }, 1500);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============ IPC ============
ipcMain.handle('get-state', () => state);

ipcMain.handle('create-project', async (event, { name, rootPath }) => {
  const id = 'proj-' + Date.now();
  const newProj = { id, name, rootPath, workingFolders: [rootPath], grokSessionId: null };
  state.projects.push(newProj);
  state.activeProjectId = id;
  if (!state.progress[id]) state.progress[id] = [];
  saveState(state);
  const task = taskStore.createTask(DATA_DIR, id, { title: 'New task' });
  return {
    project: newProj,
    tasks: taskStore.listTasks(DATA_DIR, id),
    activeTask: task,
    history: []
  };
});

ipcMain.handle('switch-project', (event, id) => {
  state.activeProjectId = id;
  saveState(state);
  const proj = getActiveProject();
  taskStore.migrateProjectSession(DATA_DIR, proj);
  return {
    project: proj,
    tasks: taskStore.listTasks(DATA_DIR, proj.id),
    activeTask: taskStore.getActiveTask(DATA_DIR, proj.id),
    history: taskStore.loadChatHistory(DATA_DIR, proj.id, taskStore.getActiveTask(DATA_DIR, proj.id)?.id)
  };
});

ipcMain.handle('add-working-folder', (event, folder) => {
  const proj = getActiveProject();
  if (!proj.workingFolders.includes(folder)) {
    proj.workingFolders.push(folder);
    saveState(state);
  }
  return proj;
});

ipcMain.handle('add-dispatch', (event, label) => {
  const proj = getActiveProject();
  const item = { id: 'disp-' + Date.now(), label, projectId: proj.id };
  state.dispatches.push(item);
  saveState(state);
  return item;
});

ipcMain.handle('run-dispatch', async (event, id) => {
  const item = state.dispatches.find(d => d.id === id);
  if (!item) return { ok: false };
  const proj = getActiveProject();
  await runGrokWithContext(item.label, proj);
  return { ok: true };
});

ipcMain.handle('add-scheduled', (event, task) => {
  state.scheduledTasks.push(task);
  saveState(state);
  // re-register crons if needed (simplified here)
  return task;
});

ipcMain.handle('run-scheduled', async (event, id) => executeScheduledTask(id));

ipcMain.handle('rename-scheduled-task', (event, { taskId, name } = {}) => {
  const task = getScheduledTask(taskId);
  if (!task) return { ok: false };
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, error: 'Name required' };
  task.name = clean;
  saveState(state);
  return { ok: true, task, hasUnviewed: hasUnviewedScheduledRuns(task) };
});

ipcMain.handle('delete-scheduled-task', (event, taskId) => {
  const idx = state.scheduledTasks.findIndex(t => t.id === taskId);
  if (idx < 0) return { ok: false };
  state.scheduledTasks.splice(idx, 1);
  saveState(state);
  return { ok: true };
});

ipcMain.handle('mark-scheduled-viewed', (event, { taskId, runId } = {}) => {
  const task = getScheduledTask(taskId);
  if (!task) return { ok: false };
  if (runId) {
    const run = (task.runs || []).find(r => r.id === runId);
    if (run) run.viewed = true;
  } else {
    (task.runs || []).forEach(r => { r.viewed = true; });
  }
  saveState(state);
  return { ok: true, task, hasUnviewed: hasUnviewedScheduledRuns(task) };
});

ipcMain.handle('update-progress', (event, items) => {
  const proj = getActiveProject();
  state.progress[proj.id] = items;
  saveState(state);
  return true;
});

ipcMain.handle('update-task-progress', (event, { taskId, items, patch } = {}) => {
  const proj = getActiveProject();
  const tid = taskId || taskStore.getActiveTask(DATA_DIR, proj.id)?.id;
  if (!tid) return { ok: false };
  let task;
  if (patch) {
    task = taskStore.mergeTaskProgress(DATA_DIR, proj.id, tid, patch);
  } else if (items) {
    task = taskStore.setTaskProgress(DATA_DIR, proj.id, tid, items);
  } else {
    return { ok: false };
  }
  mainWindow?.webContents.send('task-session-updated', { task, projectId: proj.id });
  return { ok: true, task };
});

ipcMain.handle('add-task-session-folder', (event, { taskId, folder } = {}) => {
  const proj = getActiveProject();
  const tid = taskId || taskStore.getActiveTask(DATA_DIR, proj.id)?.id;
  if (!tid || !folder) return { ok: false };
  const task = taskStore.addTaskSessionFolder(DATA_DIR, proj.id, tid, folder);
  mainWindow?.webContents.send('task-session-updated', { task, projectId: proj.id });
  return { ok: true, task };
});

ipcMain.handle('add-task-session-connector', (event, { taskId, connector } = {}) => {
  const proj = getActiveProject();
  const tid = taskId || taskStore.getActiveTask(DATA_DIR, proj.id)?.id;
  if (!tid || !connector) return { ok: false };
  const task = taskStore.addTaskSessionConnector(DATA_DIR, proj.id, tid, connector);
  mainWindow?.webContents.send('task-session-updated', { task, projectId: proj.id });
  return { ok: true, task };
});

ipcMain.handle('sync-task-session', () => {
  const proj = getActiveProject();
  const task = taskStore.getActiveTask(DATA_DIR, proj.id);
  if (!task) return { ok: false };
  const updated = syncTaskSession(proj, task);
  return { ok: true, task: updated };
});

ipcMain.handle('rename-conversation-task', (event, { taskId, title } = {}) => {
  const proj = getActiveProject();
  const tid = taskId || taskStore.getActiveTask(DATA_DIR, proj.id)?.id;
  if (!tid) return { ok: false };
  const task = taskStore.renameTask(DATA_DIR, proj.id, tid, title);
  if (!task) return { ok: false };
  return { ok: true, task, manifest: taskStore.listTasks(DATA_DIR, proj.id) };
});

ipcMain.handle('delete-conversation-task', (event, { taskId } = {}) => {
  const proj = getActiveProject();
  if (!taskId) return { ok: false };
  const ok = taskStore.deleteTask(DATA_DIR, proj.id, taskId);
  const manifest = taskStore.listTasks(DATA_DIR, proj.id);
  const activeTask = taskStore.getActiveTask(DATA_DIR, proj.id);
  return {
    ok,
    manifest,
    activeTask,
    history: activeTask
      ? taskStore.loadChatHistory(DATA_DIR, proj.id, activeTask.id)
      : []
  };
});

ipcMain.handle('get-connectors', async () => {
  // Real: try to get from grok mcp or config
  try {
    const { stdout } = await new Promise(res => {
      const p = spawn(GROK_BIN, ['mcp', 'list', '--json']);
      let out = '';
      p.stdout.on('data', d => out += d);
      p.on('close', () => res({ stdout: out }));
    });
    return JSON.parse(stdout || '[]');
  } catch (e) {
    return state.connectors || ['github'];
  }
});

ipcMain.handle('capture-screen', async () => {
  const tmp = path.join(DATA_DIR, 'last-capture.png');
  return new Promise(resolve => {
    exec(`screencapture -x "${tmp}"`, err => {
      if (err) return resolve({ ok: false, error: err.message });
      const b64 = fs.readFileSync(tmp).toString('base64');
      resolve({ ok: true, base64: b64, mime: 'image/png', path: tmp });
    });
  });
});

ipcMain.handle('desktop-action', async (event, { action, params }) => {
  try {
    const result = await runDesktopAction(action, params || {});
    const summary = result.ok
      ? `${result.action || action}${result.x != null ? ` @ (${result.x}, ${result.y})` : ''}${result.text ? `: "${result.text}"` : ''}`
      : (result.error || 'Action failed');
    return { ...result, result: summary };
  } catch (e) {
    return { ok: false, error: e.message, result: e.message };
  }
});

// Computer Use trigger from menu
ipcMain.on('trigger-capture', () => {
  mainWindow?.webContents.send('trigger-capture');
});

// When user wants to run a specific Cowork-style task with full current context
ipcMain.handle('stop-grok', () => stopActiveGrok());

ipcMain.handle('run-cowork-prompt', async (event, payload) => {
  const userPrompt = typeof payload === 'string' ? payload : (payload?.prompt || '');
  const attachments = typeof payload === 'object' && payload?.attachments ? payload.attachments : [];
  const proj = getActiveProject();
  let task = getTaskContext(proj.id);
  if (task) {
    const msg = { role: 'user', content: userPrompt || '(screenshot attached)' };
    if (attachments.length) msg.attachments = attachments;
    taskStore.appendMessages(DATA_DIR, proj.id, task.id, [msg]);
    const titleSource = userPrompt || attachments[0]?.name || 'Screenshot task';
    const patch = {
      title: task.title === 'New task' ? taskStore.titleFromPrompt(titleSource) : task.title
    };
    taskStore.updateTask(DATA_DIR, proj.id, task.id, patch);
    task = taskStore.getActiveTask(DATA_DIR, proj.id);
    mainWindow?.webContents.send('task-session-updated', { task, projectId: proj.id });
  }
  await runGrokWithContext(userPrompt || 'Please analyze the attached screenshot(s).', proj, { attachments });
  return { ok: true, taskId: task?.id };
});

ipcMain.handle('save-attachment', async (event, { base64, mime, name, sourcePath } = {}) => {
  const proj = getActiveProject();
  const task = getTaskContext(proj.id);
  if (!task) return { ok: false, error: 'No active task' };

  const dir = attachmentDir(proj.id, task.id);
  fs.mkdirSync(dir, { recursive: true });

  let destPath;
  if (sourcePath && fs.existsSync(sourcePath)) {
    const ext = path.extname(sourcePath) || '.png';
    destPath = path.join(dir, `${Date.now()}-${path.basename(sourcePath, ext)}${ext}`);
    fs.copyFileSync(sourcePath, destPath);
  } else if (base64) {
    const ext = (mime || '').includes('jpeg') ? '.jpg' : '.png';
    destPath = path.join(dir, `${Date.now()}-${name || 'screenshot'}${ext}`);
    fs.writeFileSync(destPath, Buffer.from(base64, 'base64'));
  } else {
    return { ok: false, error: 'No image data provided' };
  }

  return {
    ok: true,
    path: destPath,
    mime: mime || 'image/png',
    name: path.basename(destPath)
  };
});

ipcMain.handle('get-attachment-preview', (event, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false };
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
    const b64 = fs.readFileSync(filePath).toString('base64');
    return { ok: true, dataUrl: `data:${mime};base64,${b64}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('list-tasks', (event, projectId) => {
  const pid = projectId || getActiveProject().id;
  const proj = state.projects.find(p => p.id === pid);
  taskStore.migrateProjectSession(DATA_DIR, proj);
  return {
    manifest: taskStore.listTasks(DATA_DIR, pid),
    activeTask: taskStore.getActiveTask(DATA_DIR, pid)
  };
});

ipcMain.handle('create-conversation-task', (event, { title } = {}) => {
  const proj = getActiveProject();
  const task = taskStore.createTask(DATA_DIR, proj.id, {
    title: title || 'New task',
    grokSessionId: null,
    progress: []
  });
  return {
    ok: true,
    task,
    history: [],
    manifest: taskStore.listTasks(DATA_DIR, proj.id)
  };
});

ipcMain.handle('switch-conversation-task', (event, taskId) => {
  const proj = getActiveProject();
  let task = taskStore.switchTask(DATA_DIR, proj.id, taskId);
  if (!task) return { ok: false };
  task = syncTaskSession(proj, task);
  return {
    ok: true,
    task,
    history: taskStore.loadChatHistory(DATA_DIR, proj.id, taskId),
    manifest: taskStore.listTasks(DATA_DIR, proj.id)
  };
});

ipcMain.handle('get-task-history', (event, { projectId, taskId } = {}) => {
  const pid = projectId || getActiveProject().id;
  const tid = taskId || taskStore.getActiveTask(DATA_DIR, pid)?.id;
  if (!tid) return [];
  return taskStore.loadChatHistory(DATA_DIR, pid, tid);
});

ipcMain.handle('append-task-messages', (event, { projectId, taskId, messages } = {}) => {
  const pid = projectId || getActiveProject().id;
  const tid = taskId || taskStore.getActiveTask(DATA_DIR, pid)?.id;
  if (!pid || !tid || !messages?.length) return { ok: false };
  taskStore.appendMessages(DATA_DIR, pid, tid, messages);
  return { ok: true, manifest: taskStore.listTasks(DATA_DIR, pid) };
});

ipcMain.handle('get-setup-status', () => getSetupStatus());

ipcMain.handle('get-boot-context', () => {
  const proj = getActiveProject();
  taskStore.migrateProjectSession(DATA_DIR, proj);
  let activeTask = taskStore.getActiveTask(DATA_DIR, proj.id);
  if (activeTask) activeTask = syncTaskSession(proj, activeTask);
  return {
    state,
    manifest: taskStore.listTasks(DATA_DIR, proj.id),
    activeTask,
    history: activeTask ? taskStore.loadChatHistory(DATA_DIR, proj.id, activeTask.id) : [],
    setup: getSetupStatus(),
    marketingView: process.env.GROK_MARKETING_VIEW || null,
    marketingCapture: process.env.GROK_MARKETING_CAPTURE || null
  };
});

ipcMain.on('marketing-view-ready', async () => {
  const outPath = process.env.GROK_MARKETING_CAPTURE;
  if (!outPath || !mainWindow) return;
  await new Promise(r => setTimeout(r, 400));
  try {
    const absPath = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const image = await mainWindow.webContents.capturePage();
    fs.writeFileSync(absPath, image.toPNG());
    const size = image.getSize();
    console.log('[marketing] captured', absPath, `${size.width}x${size.height}`);
  } catch (e) {
    console.error('[marketing] capture failed:', e);
    process.exitCode = 1;
  }
  setImmediate(() => app.quit());
});

ipcMain.handle('set-act-without-asking', (event, value) => {
  state.actWithoutAsking = !!value;
  saveState(state);
  return state.actWithoutAsking;
});

ipcMain.handle('pick-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || !filePaths[0]) return { ok: false };
  return { ok: true, path: filePaths[0] };
});

ipcMain.handle('open-path', async (event, targetPath) => {
  if (!targetPath) return { ok: false, error: 'No path provided' };
  const err = await shell.openPath(targetPath);
  return { ok: !err, error: err || null };
});

ipcMain.handle('list-artifacts', () => {
  const proj = getActiveProject();
  const task = getTaskContext(proj.id);
  const artifacts = [];
  if (task) {
    const dir = attachmentDir(proj.id, task.id);
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        try {
          if (fs.statSync(full).isFile()) {
            artifacts.push({ name, path: full, type: 'attachment' });
          }
        } catch (e) {}
      }
    }
  }
  const capture = path.join(DATA_DIR, 'last-capture.png');
  if (fs.existsSync(capture)) {
    artifacts.push({ name: 'last-capture.png', path: capture, type: 'capture' });
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name));
  return { artifacts };
});

const DESKTOP_QUEUE_FILE = path.join(DATA_DIR, 'desktop-queue.json');
const DESKTOP_QUEUE_RESULT = path.join(DATA_DIR, 'desktop-queue-result.json');

async function processDesktopQueue() {
  if (!fs.existsSync(DESKTOP_QUEUE_FILE)) return;
  let job;
  try {
    job = JSON.parse(fs.readFileSync(DESKTOP_QUEUE_FILE, 'utf8'));
    fs.unlinkSync(DESKTOP_QUEUE_FILE);
  } catch (e) {
    return;
  }
  const results = [];
  try {
    for (const step of (job.steps || [])) {
      if (step.delayMs) await new Promise(r => setTimeout(r, step.delayMs));
      const res = await runDesktopAction(step.action, step.params || {});
      results.push(res);
      if (!res.ok && job.stopOnError) break;
    }
    fs.writeFileSync(DESKTOP_QUEUE_RESULT, JSON.stringify({ ok: true, results, ts: Date.now() }, null, 2));
  } catch (e) {
    fs.writeFileSync(DESKTOP_QUEUE_RESULT, JSON.stringify({ ok: false, error: e.message, results, ts: Date.now() }, null, 2));
  }
}

function watchDesktopQueue() {
  try {
    fs.watch(DATA_DIR, (_event, filename) => {
      if (filename === 'desktop-queue.json') setTimeout(processDesktopQueue, 30);
    });
  } catch (e) {
    console.warn('[main] desktop queue watcher failed', e.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Grok Executive Suite',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    vibrancy: 'under-window',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);
  mainWindow.webContents.session.setSpellCheckerEnabled(true);

  mainWindow.webContents.on('context-menu', (event, params) => {
    const template = [];

    if (params.misspelledWord && params.dictionarySuggestions?.length) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 6)) {
        template.push({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion)
        });
      }
      template.push({ type: 'separator' });
    } else if (params.misspelledWord) {
      template.push({ label: 'No suggestions', enabled: false });
      template.push({ type: 'separator' });
    }

    if (params.isEditable) {
      template.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' }
      );
    } else if (params.selectionText) {
      template.push({ role: 'copy' });
    }

    if (template.length) {
      event.preventDefault();
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.env.GROK_COWORK_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  const template = [
    { label: 'Grok Executive Suite', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'Executive',
      submenu: [
        { label: 'Capture Desktop', click: () => mainWindow.webContents.send('trigger-capture') },
        { label: 'New Project', click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
            if (!canceled && filePaths[0]) {
              mainWindow.webContents.send('create-project-from-ui', filePaths[0]);
            }
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  state.projects.forEach(p => taskStore.migrateProjectSession(DATA_DIR, p));
  watchDesktopQueue();
  createWindow();

  // Register any enabled scheduled tasks (general, project-aware)
  state.scheduledTasks.forEach(task => {
    if (task.enabled) {
      try {
        cron.schedule(task.cron, () => {
          executeScheduledTask(task.id).catch(e => console.error('[main] scheduled run failed', e));
        });
      } catch (e) {}
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});