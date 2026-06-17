#!/usr/bin/env node
/** Restore state.json after marketing screenshot session. */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.grok-cowork');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BACKUP_STATE = path.join(DATA_DIR, 'state.json.bak-marketing');

if (!fs.existsSync(BACKUP_STATE)) {
  console.log('[marketing] No backup found — nothing to restore.');
  process.exit(0);
}

fs.copyFileSync(BACKUP_STATE, STATE_FILE);
fs.unlinkSync(BACKUP_STATE);
console.log('[marketing] Restored live state from backup.');