// Smoke test of the MCP server in a built CLI: starts `usertax mcp` over stdio, performs the
// MCP handshake with raw JSON-RPC (no SDK, so it checks the bundled server on its own), lists
// the tools and calls `alternatives`. Usage: node scripts/mcp-smoke.js <path to bin/usertax.js>
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const bin = process.argv[2] ?? 'packages/cli/bin/usertax.js';
const server = spawn(process.execPath, [bin, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: server.stdout });
const pending = new Map();
lines.on('line', (line) => {
  const message = JSON.parse(line);
  pending.get(message.id)?.(message);
});
let nextId = 1;
function request(method, params) {
  const id = nextId++;
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}
const timeout = setTimeout(() => {
  process.stderr.write('MCP smoke test timed out\n');
  process.exit(1);
}, 15_000);

const init = await request('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'usertax-smoke', version: '1' },
});
server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
const tools = await request('tools/list', {});
const call = await request('tools/call', {
  name: 'alternatives',
  arguments: { package: 'moment' },
});
const names = (tools.result?.tools ?? []).map((t) => t.name).sort();
const failures = [];
if (init.result?.serverInfo?.name !== 'usertax') failures.push('initialize: unexpected serverInfo');
if (names.join() !== 'alternatives,compare,explain_package,measure')
  failures.push(`tools/list: ${names.join()}`);
if (!String(call.result?.content?.[0]?.text).includes('day.js'))
  failures.push('tools/call alternatives: no day.js');
clearTimeout(timeout);
server.stdin.end();
if (failures.length > 0) {
  process.stderr.write(`MCP smoke test failed:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `MCP ok: ${init.result.serverInfo.name} ${init.result.serverInfo.version}, protocol ${init.result.protocolVersion}, tools ${names.join(', ')}\n`,
);
