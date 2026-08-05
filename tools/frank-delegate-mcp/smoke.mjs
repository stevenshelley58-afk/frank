// Smoke test: speak MCP stdio JSON-RPC to the built frank-delegate-mcp server.
// initialize -> tools/list -> tools/call(delegate_task, unsure) -> verify result text.
import { spawn } from 'node:child_process';

const web = process.env.FRANK_WEB_URL ?? 'http://localhost:3001';
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: 'tools/frank-delegate-mcp',
  env: { ...process.env, FRANK_WEB_URL: web },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
  });
}

async function main() {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.1' },
  });
  console.log('init server:', JSON.stringify(init.result?.serverInfo));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc('tools/list', {});
  const names = (tools.result?.tools ?? []).map((t) => t.name);
  console.log('tools:', names.join(', '));

  const call = await rpc('tools/call', {
    name: 'delegate_task',
    arguments: {
      room: 'chase',
      task: 'Write a one-paragraph spec for the selfie-to-character stylizer art direction',
      why: 'smoke test from Phase 3 verification',
      confidence: 'unsure',
    },
  });
  console.log('call result:', JSON.stringify(call.result));
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  child.kill();
  process.exit(1);
});
