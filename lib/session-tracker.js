const fs = require('fs');
const path = require('path');
const os = require('os');

const TOOL_CONNECTOR_MAP = {
  Grep: 'Filesystem (Grep)',
  Glob: 'Filesystem (Glob)',
  Read: 'Filesystem (Read)',
  Write: 'Filesystem (Write)',
  StrReplace: 'Filesystem (Edit)',
  Delete: 'Filesystem (Delete)',
  Shell: 'Terminal / Shell',
  AwaitShell: 'Terminal / Shell',
  WebSearch: 'Web Search',
  WebFetch: 'Web Fetch',
  Task: 'Subagent',
  SwitchMode: 'Plan Mode',
  GenerateImage: 'Image Generation',
  EditNotebook: 'Notebook',
  CallMcpTool: 'MCP Connector',
  ListMcpResources: 'MCP Connector',
  FetchMcpResource: 'MCP Connector',
  update_goal: 'Goal Progress',
  TodoWrite: 'Task Planning'
};

function sessionsBase(rootPath) {
  return path.join(os.homedir(), '.grok', 'sessions', encodeURIComponent(rootPath));
}

function sessionEventsPath(rootPath, sessionId) {
  return path.join(sessionsBase(rootPath), sessionId, 'events.jsonl');
}

function mapToolName(name) {
  if (!name) return null;
  return TOOL_CONNECTOR_MAP[name] || name;
}

function parseEventLine(line) {
  try { return JSON.parse(line); } catch (e) { return null; }
}

function findNewestSessionDir(base) {
  if (!fs.existsSync(base)) return null;
  let best = null;
  let bestMtime = 0;
  for (const name of fs.readdirSync(base)) {
    if (name.endsWith('.jsonl') || name === 'prompt_history.jsonl') continue;
    const full = path.join(base, name);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      const events = path.join(full, 'events.jsonl');
      const mtime = fs.existsSync(events) ? fs.statSync(events).mtimeMs : st.mtimeMs;
      if (mtime >= bestMtime) {
        bestMtime = mtime;
        best = full;
      }
    } catch (e) {}
  }
  return best;
}

function extractPathsFromEvent(ev) {
  const paths = new Set();
  const scan = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      const matches = value.matchAll(/(\/(?:Users|private|tmp|var|opt|Library)[^\s"'`,;)]+)/g);
      for (const m of matches) {
        const p = m[1];
        const parts = p.split('/');
        if (p.includes('.')) parts.pop();
        const dir = parts.join('/') || '/';
        if (dir.length > 1) paths.add(dir);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const v of Object.values(value)) scan(v);
    }
  };
  scan(ev);
  return [...paths];
}

function ingestEvents(taskStore, dataDir, project, task, lines, seenTools) {
  if (!task || !lines?.length) return task;
  let current = task;
  for (const line of lines) {
    const ev = parseEventLine(line);
    if (!ev) continue;
    if (ev.type === 'tool_started' && ev.tool_name) {
      const key = `${ev.type}:${ev.tool_name}`;
      if (seenTools.has(key)) continue;
      seenTools.add(key);
      const connector = mapToolName(ev.tool_name);
      if (connector) {
        current = taskStore.addTaskSessionConnector(dataDir, project.id, task.id, connector) || current;
      }
    }
    if (ev.tool_name === 'update_goal' || (ev.type === 'tool_started' && ev.tool_name === 'update_goal')) {
      // progress handled separately if args available
    }
    const folders = extractPathsFromEvent(ev);
    for (const folder of folders) {
      current = taskStore.addTaskSessionFolder(dataDir, project.id, task.id, folder) || current;
    }
  }
  return current;
}

function backfillTaskSession(taskStore, dataDir, project, task) {
  if (!task) return null;
  const seenTools = new Set();
  let current = task;

  if (task.grokSessionId) {
    const file = sessionEventsPath(project.rootPath, task.grokSessionId);
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      current = ingestEvents(taskStore, dataDir, project, task, lines, seenTools) || current;
    }
  }

  const newest = findNewestSessionDir(sessionsBase(project.rootPath));
  if (newest) {
    const eventsFile = path.join(newest, 'events.jsonl');
    if (fs.existsSync(eventsFile)) {
      const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
      current = ingestEvents(taskStore, dataDir, project, task, lines, seenTools) || current;
    }
  }

  return current;
}

function createSessionWatcher(taskStore, dataDir, project, task, onUpdate) {
  const seenTools = new Set();
  let offset = 0;
  let eventsFile = null;
  let watcher = null;
  let poll = null;

  function tick() {
    if (!eventsFile || !fs.existsSync(eventsFile)) {
      const dir = findNewestSessionDir(sessionsBase(project.rootPath));
      if (dir) eventsFile = path.join(dir, 'events.jsonl');
      if (!eventsFile || !fs.existsSync(eventsFile)) return;
      offset = 0;
    }
    const content = fs.readFileSync(eventsFile, 'utf8');
    if (content.length <= offset) return;
    const chunk = content.slice(offset);
    offset = content.length;
    const lines = chunk.split('\n').filter(Boolean);
    const updated = ingestEvents(taskStore, dataDir, project, task, lines, seenTools);
    if (updated && onUpdate) onUpdate(updated);
  }

  poll = setInterval(tick, 350);
  tick();

  return () => {
    if (poll) clearInterval(poll);
    if (watcher) try { watcher.close(); } catch (e) {}
  };
}

module.exports = {
  TOOL_CONNECTOR_MAP,
  sessionsBase,
  sessionEventsPath,
  mapToolName,
  backfillTaskSession,
  createSessionWatcher,
  findNewestSessionDir
};