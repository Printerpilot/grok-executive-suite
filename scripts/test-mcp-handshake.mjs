#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runSh = process.argv[2] || path.join(__dirname, '../mcp/executive-suite-desktop/run.sh');
const cwd = process.argv[3] || path.join(__dirname, '..');

const child = spawn('bash', [runSh], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

let out = '';
let err = '';
child.stdout.on('data', d => { out += d; console.log('STDOUT:', d.toString()); });
child.stderr.on('data', d => { err += d; console.error('STDERR:', d.toString()); });

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' }
  }
};

child.stdin.write(JSON.stringify(init) + '\n');

setTimeout(() => {
  child.kill();
  console.log('--- done ---');
  if (!out) console.error('No stdout — server may have crashed. stderr:', err);
  process.exit(out ? 0 : 1);
}, 3000);