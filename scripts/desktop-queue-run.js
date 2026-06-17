#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.grok-cowork');
const QUEUE = path.join(DATA_DIR, 'desktop-queue.json');
const RESULT = path.join(DATA_DIR, 'desktop-queue-result.json');

async function main() {
  const steps = JSON.parse(process.argv[2] || '[]');
  if (!steps.length) {
    console.error('Usage: node desktop-queue-run.js \'[{"action":"open-app","params":{"app":"Calculator"}}]\'');
    process.exit(1);
  }

  try { fs.unlinkSync(RESULT); } catch (e) {}
  fs.writeFileSync(QUEUE, JSON.stringify({ steps, stopOnError: true }, null, 2));

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (fs.existsSync(RESULT)) {
      const res = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    }
    await new Promise(r => setTimeout(r, 100));
  }
  console.error('Timed out waiting for Grok Cowork to process desktop queue.');
  process.exit(1);
}

main();