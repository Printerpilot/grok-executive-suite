const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execFileAsync = promisify(execFile);
const JXA_MOUSE = path.join(__dirname, 'mouse-control.jxa');
const JXA_CURSOR = path.join(__dirname, 'cursor-position.jxa');

function runJxa(scriptPath, args = []) {
  return execFileAsync('osascript', ['-l', 'JavaScript', scriptPath, ...args], {
    timeout: 15000,
    maxBuffer: 1024 * 1024
  }).then(({ stdout }) => stdout.trim());
}

function escapeAppleScriptString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

async function getCursorPosition() {
  const out = await runJxa(JXA_CURSOR);
  return JSON.parse(out);
}

async function moveCursor(x, y) {
  await runJxa(JXA_MOUSE, ['move', String(Math.round(x)), String(Math.round(y))]);
  return { ok: true, action: 'move-cursor', x, y };
}

async function clickAt(x, y, button = 'left', clickCount = 1) {
  await runJxa(JXA_MOUSE, [
    'click',
    String(Math.round(x)),
    String(Math.round(y)),
    button,
    String(clickCount)
  ]);
  return { ok: true, action: button === 'right' ? 'right-click' : 'click', x, y, clickCount };
}

async function typeText(text) {
  const safe = escapeAppleScriptString(text);
  const script = `tell application "System Events" to keystroke "${safe}"`;
  await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
  return { ok: true, action: 'type', text };
}

async function pressKey(keyCode, modifiers = []) {
  const modMap = { cmd: 'command down', shift: 'shift down', option: 'option down', control: 'control down' };
  const modClause = modifiers.length
    ? ` using {${modifiers.map(m => modMap[m] || `${m} down`).join(', ')}}`
    : '';
  const script = `tell application "System Events" to key code ${Number(keyCode)}${modClause}`;
  await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
  return { ok: true, action: 'key', keyCode, modifiers };
}

async function focusApp(appName) {
  const safe = escapeAppleScriptString(appName);
  await execFileAsync('osascript', ['-e', `tell application "${safe}" to activate`], { timeout: 15000 });
  return { ok: true, action: 'focus-app', app: appName };
}

async function openApp(appName) {
  await execFileAsync('open', ['-a', appName], { timeout: 15000 });
  return { ok: true, action: 'open-app', app: appName };
}

async function runDesktopAction(action, params = {}) {
  switch (action) {
    case 'get-cursor':
      return { ok: true, ...(await getCursorPosition()) };
    case 'move-cursor':
      return moveCursor(params.x ?? 0, params.y ?? 0);
    case 'click':
    case 'left-click':
      return clickAt(params.x ?? 0, params.y ?? 0, 'left', params.clickCount || 1);
    case 'right-click':
      return clickAt(params.x ?? 0, params.y ?? 0, 'right', 1);
    case 'double-click':
      return clickAt(params.x ?? 0, params.y ?? 0, 'left', 2);
    case 'type':
      return typeText(params.text || '');
    case 'key':
      return pressKey(params.keyCode ?? 36, params.modifiers || []);
    case 'focus-app':
      return focusApp(params.app || 'Finder');
    case 'open-app':
      return openApp(params.app || 'Finder');
    default:
      return { ok: false, error: `Unknown desktop action: ${action}` };
  }
}

module.exports = {
  getCursorPosition,
  moveCursor,
  clickAt,
  typeText,
  pressKey,
  focusApp,
  openApp,
  runDesktopAction
};