const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function projectDir(dataDir, projectId) {
  return path.join(dataDir, 'projects', projectId);
}

function manifestPath(dataDir, projectId) {
  return path.join(projectDir(dataDir, projectId), 'manifest.json');
}

function chatPath(dataDir, projectId, taskId) {
  return path.join(projectDir(dataDir, projectId), taskId, 'chat.jsonl');
}

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return fallback;
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadManifest(dataDir, projectId) {
  const file = manifestPath(dataDir, projectId);
  const manifest = readJson(file, null);
  if (manifest && Array.isArray(manifest.tasks)) {
    manifest.tasks = manifest.tasks.map(t => ensureTaskFields({
      ...t,
      grokSessionId: t.grokSessionId || null,
      progress: normalizeProgress(t.progress || []),
      sessionFolders: Array.isArray(t.sessionFolders) ? t.sessionFolders : [],
      sessionConnectors: normalizeConnectors(t.sessionConnectors || [])
    }));
    return manifest;
  }
  return { activeTaskId: null, tasks: [] };
}

function saveManifest(dataDir, projectId, manifest) {
  writeJson(manifestPath(dataDir, projectId), manifest);
}

function makeTaskId() {
  return 'task-' + Date.now();
}

function makeProgressId() {
  return 'prog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

function normalizeProgress(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (typeof item === 'string') {
      return { id: makeProgressId(), label: item, done: false };
    }
    return {
      id: item.id || makeProgressId(),
      label: String(item.label || item.content || 'Step ' + (i + 1)),
      done: !!item.done || !!item.completed
    };
  });
}

function normalizeConnectors(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const name = typeof item === 'string' ? item : (item.name || item.id || '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      lastUsed: item.lastUsed || new Date().toISOString()
    });
  }
  return out;
}

function titleFromPrompt(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean) return 'New task';
  return clean.length > 48 ? clean.slice(0, 45) + '…' : clean;
}

function createTask(dataDir, projectId, { title, grokSessionId = null, progress = null } = {}) {
  ensureDir(projectDir(dataDir, projectId));
  const manifest = loadManifest(dataDir, projectId);
  const now = new Date().toISOString();
  const task = {
    id: makeTaskId(),
    title: title || 'New task',
    createdAt: now,
    updatedAt: now,
    grokSessionId: grokSessionId || null,
    progress: normalizeProgress(progress || []),
    sessionFolders: [],
    sessionConnectors: []
  };
  manifest.tasks.unshift(task);
  manifest.activeTaskId = task.id;
  saveManifest(dataDir, projectId, manifest);
  ensureDir(path.dirname(chatPath(dataDir, projectId, task.id)));
  return task;
}

function listTasks(dataDir, projectId) {
  const manifest = loadManifest(dataDir, projectId);
  return manifest;
}

function getActiveTask(dataDir, projectId) {
  const manifest = loadManifest(dataDir, projectId);
  if (!manifest.activeTaskId) return null;
  return manifest.tasks.find(t => t.id === manifest.activeTaskId) || null;
}

function switchTask(dataDir, projectId, taskId) {
  const manifest = loadManifest(dataDir, projectId);
  const task = manifest.tasks.find(t => t.id === taskId);
  if (!task) return null;
  manifest.activeTaskId = taskId;
  saveManifest(dataDir, projectId, manifest);
  return task;
}

function updateTask(dataDir, projectId, taskId, patch) {
  const manifest = loadManifest(dataDir, projectId);
  const idx = manifest.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return null;
  const next = { ...manifest.tasks[idx], ...patch, updatedAt: new Date().toISOString() };
  if (patch.progress) next.progress = normalizeProgress(patch.progress);
  if (patch.sessionConnectors) next.sessionConnectors = normalizeConnectors(patch.sessionConnectors);
  manifest.tasks[idx] = next;
  saveManifest(dataDir, projectId, manifest);
  return manifest.tasks[idx];
}

function renameTask(dataDir, projectId, taskId, title) {
  const clean = String(title || '').trim();
  if (!clean) return null;
  return updateTask(dataDir, projectId, taskId, { title: clean });
}

function deleteTask(dataDir, projectId, taskId) {
  const manifest = loadManifest(dataDir, projectId);
  const idx = manifest.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return false;
  manifest.tasks.splice(idx, 1);
  if (manifest.activeTaskId === taskId) {
    manifest.activeTaskId = manifest.tasks.length > 0 ? manifest.tasks[0].id : null;
  }
  saveManifest(dataDir, projectId, manifest);
  try {
    const taskPath = path.join(projectDir(dataDir, projectId), taskId);
    if (fs.existsSync(taskPath)) fs.rmSync(taskPath, { recursive: true, force: true });
  } catch(e) { console.error('Failed to delete task directory', e); }
  return true;
}

function getTaskProgress(dataDir, projectId, taskId) {
  const manifest = loadManifest(dataDir, projectId);
  const task = manifest.tasks.find(t => t.id === taskId);
  if (!task) return [];
  if (!Array.isArray(task.progress)) task.progress = [];
  return task.progress;
}

function setTaskProgress(dataDir, projectId, taskId, items) {
  return updateTask(dataDir, projectId, taskId, { progress: normalizeProgress(items) });
}

function mergeTaskProgress(dataDir, projectId, taskId, patch = {}) {
  const manifest = loadManifest(dataDir, projectId);
  const idx = manifest.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return null;
  const task = manifest.tasks[idx];
  const progress = normalizeProgress(task.progress || []);

  if (patch.message && !patch.completed && !patch.blocked_reason) {
    const label = String(patch.message).trim();
    if (label && progress.length) {
      const open = progress.find(p => !p.done);
      if (open && !open.label.includes(label)) {
        open.label = label;
      }
    }
  }

  if (patch.completed) {
    const openIdx = progress.findIndex(p => !p.done);
    if (openIdx >= 0) progress[openIdx].done = true;
    if (patch.message) {
      const doneLabel = String(patch.message).trim();
      if (doneLabel && !progress.some(p => p.label === doneLabel)) {
        progress.push({ id: makeProgressId(), label: doneLabel, done: true });
      }
    }
  }

  if (patch.blocked_reason) {
    const label = 'Blocked: ' + String(patch.blocked_reason).trim();
    if (!progress.some(p => p.label === label)) {
      progress.push({ id: makeProgressId(), label, done: false });
    }
  }

  if (Array.isArray(patch.items)) {
    return setTaskProgress(dataDir, projectId, taskId, patch.items);
  }

  return updateTask(dataDir, projectId, taskId, { progress });
}

function addTaskSessionFolder(dataDir, projectId, taskId, folderPath) {
  const clean = String(folderPath || '').trim();
  if (!clean || !clean.startsWith('/')) return null;
  const manifest = loadManifest(dataDir, projectId);
  const idx = manifest.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return null;
  const folders = Array.isArray(manifest.tasks[idx].sessionFolders)
    ? [...manifest.tasks[idx].sessionFolders]
    : [];
  if (!folders.includes(clean)) folders.push(clean);
  return updateTask(dataDir, projectId, taskId, { sessionFolders: folders });
}

function addTaskSessionConnector(dataDir, projectId, taskId, connectorName) {
  const name = String(connectorName || '').trim();
  if (!name) return null;
  const manifest = loadManifest(dataDir, projectId);
  const idx = manifest.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) return null;
  const connectors = normalizeConnectors(manifest.tasks[idx].sessionConnectors || []);
  const existing = connectors.find(c => c.name === name);
  if (existing) {
    existing.lastUsed = new Date().toISOString();
  } else {
    connectors.push({ name, lastUsed: new Date().toISOString() });
  }
  return updateTask(dataDir, projectId, taskId, { sessionConnectors: connectors });
}

function ensureTaskFields(task) {
  if (!task) return task;
  if (!Array.isArray(task.progress)) task.progress = [];
  if (!Array.isArray(task.sessionFolders)) task.sessionFolders = [];
  if (!Array.isArray(task.sessionConnectors)) task.sessionConnectors = [];
  return task;
}

function appendMessages(dataDir, projectId, taskId, messages) {
  if (!messages || !messages.length) return;
  const file = chatPath(dataDir, projectId, taskId);
  ensureDir(path.dirname(file));
  const lines = messages.map(m => JSON.stringify({
    role: m.role,
    content: m.content,
    ts: m.ts || new Date().toISOString()
  })).join('\n') + '\n';
  fs.appendFileSync(file, lines, 'utf8');
  const manifest = loadManifest(dataDir, projectId);
  const idx = manifest.tasks.findIndex(t => t.id === taskId);
  if (idx >= 0) {
    const firstUser = messages.find(m => m.role === 'user');
    if (manifest.tasks[idx].title === 'New task' && firstUser?.content) {
      manifest.tasks[idx].title = titleFromPrompt(firstUser.content);
    }
    manifest.tasks[idx].updatedAt = new Date().toISOString();
    saveManifest(dataDir, projectId, manifest);
  }
}

function loadChatHistory(dataDir, projectId, taskId) {
  const file = chatPath(dataDir, projectId, taskId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try { messages.push(JSON.parse(line)); } catch (e) {}
  }
  return messages;
}

function ensureDefaultTask(dataDir, projectId, { grokSessionId = null, title = 'Current task' } = {}) {
  const manifest = loadManifest(dataDir, projectId);
  if (manifest.tasks.length > 0) {
    if (!manifest.activeTaskId) {
      manifest.activeTaskId = manifest.tasks[0].id;
      saveManifest(dataDir, projectId, manifest);
    }
    return manifest.tasks.find(t => t.id === manifest.activeTaskId) || manifest.tasks[0];
  }
  return createTask(dataDir, projectId, { title, grokSessionId });
}

function migrateProjectSession(dataDir, project) {
  if (!project?.id) return null;
  const manifest = loadManifest(dataDir, project.id);
  if (manifest.tasks.length > 0) return getActiveTask(dataDir, project.id);

  const task = createTask(dataDir, project.id, {
    title: project.name ? `${project.name} — current` : 'Current task',
    grokSessionId: project.grokSessionId || null
  });

  const historyFile = chatPath(dataDir, project.id, task.id);
  const grokHistory = path.join(
    require('os').homedir(),
    '.grok',
    'sessions',
    encodeURIComponent(project.rootPath),
    'prompt_history.jsonl'
  );

  if (fs.existsSync(grokHistory)) {
    const lines = fs.readFileSync(grokHistory, 'utf8').split('\n').filter(Boolean);
    const toImport = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const prompt = row.prompt || '';
        const userPart = prompt.includes('User request / dispatch:\n')
          ? prompt.split('User request / dispatch:\n').pop().trim()
          : prompt.trim();
        if (userPart) {
          toImport.push({
            role: 'user',
            content: userPart,
            ts: row.timestamp || new Date().toISOString()
          });
        }
      } catch (e) {}
    }
    if (toImport.length) appendMessages(dataDir, project.id, task.id, toImport);
  }

  return task;
}

module.exports = {
  projectDir,
  loadManifest,
  saveManifest,
  createTask,
  listTasks,
  getActiveTask,
  switchTask,
  updateTask,
  renameTask,
  deleteTask,
  getTaskProgress,
  setTaskProgress,
  mergeTaskProgress,
  addTaskSessionFolder,
  addTaskSessionConnector,
  appendMessages,
  loadChatHistory,
  ensureDefaultTask,
  migrateProjectSession,
  titleFromPrompt,
  normalizeProgress,
  makeProgressId,
  ensureTaskFields
};