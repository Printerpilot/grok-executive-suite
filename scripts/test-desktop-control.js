#!/usr/bin/env node
const {
  getCursorPosition,
  moveCursor,
  clickAt,
  typeText,
  runDesktopAction
} = require('../lib/desktop-control');

async function assertOk(label, result) {
  if (!result.ok) throw new Error(`${label} failed: ${result.error || JSON.stringify(result)}`);
  console.log(`✓ ${label}`, result.result || result);
}

async function main() {
  console.log('Testing osascript/JXA desktop control...\n');

  const pos = await getCursorPosition();
  console.log('✓ getCursorPosition', pos);
  if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
    throw new Error('Cursor position missing x/y');
  }

  await assertOk('moveCursor', await moveCursor(pos.x + 5, pos.y + 5));
  await assertOk('moveCursor back', await moveCursor(pos.x, pos.y));

  await assertOk('left-click', await clickAt(pos.x, pos.y, 'left', 1));
  await assertOk('right-click', await clickAt(pos.x, pos.y, 'right', 1));
  await assertOk('double-click', await clickAt(pos.x, pos.y, 'left', 2));

  await assertOk('type via runDesktopAction', await runDesktopAction('type', { text: 'cowork-test' }));
  await assertOk('get-cursor via runDesktopAction', await runDesktopAction('get-cursor'));

  console.log('\nAll desktop control tests passed.');
}

main().catch((err) => {
  console.error('\nDesktop control test failed:', err.message);
  console.error('Grant Accessibility permission to Terminal/Electron in System Settings → Privacy & Security → Accessibility.');
  process.exit(1);
});