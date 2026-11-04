import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatBytes, parseReport } from '@usertax/core';
import { createMcpServer, main, mcpCommand } from 'usertax';

const fixture = new URL('../../measure/test/fixtures/vite-dist/', import.meta.url);

/** Connects a real MCP client to the server over an in-memory transport. */
async function connect(cwd: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ version: '9.9.9', cwd, env: {} });
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { text: first?.text ?? '', isError: result.isError === true };
}

describe('usertax MCP server', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'usertax-mcp-'));
    await cp(fixture, join(root, 'web', 'dist'), { recursive: true });
    await writeFile(
      join(root, 'web', 'package.json'),
      JSON.stringify({ name: '@acme/web', dependencies: { 'react-dom': '19.3.1' } }),
    );
  });

  it('lists its tools with descriptions and read-only hints', async () => {
    const client = await connect(root);
    expect(client.getServerVersion()).toEqual({ name: 'usertax', version: '9.9.9' });
    expect(client.getInstructions()).toContain('do not estimate them');
    const { tools } = await client.listTools();
    expect(tools.map((t) => [t.name, t.annotations?.readOnlyHint])).toEqual([
      ['measure', false],
      ['compare', true],
      ['explain_package', true],
      ['alternatives', true],
    ]);
    for (const tool of tools) expect(tool.description?.length).toBeGreaterThan(40);
  });

  it('measures, compares and explains with the same numbers as the CLI', async () => {
    const client = await connect(root);
    const measured = await call(client, 'measure', {
      path: 'web',
      output: 'head.json',
      framework: 'vite',
    });
    expect(measured.isError).toBe(false);
    expect(measured.text).toContain(`Report saved to ${join(root, 'head.json')}`);
    expect(measured.text).toContain('| JS total (gzip) |');
    const report = parseReport(JSON.parse(await readFile(join(root, 'head.json'), 'utf8')));
    expect(report.apps[0]?.framework).toBe('vite');

    const diff = await call(client, 'compare', { head: 'head.json', base: 'head.json' });
    const out: string[] = [];
    const io = { stdout: (t: string) => out.push(t), stderr: () => undefined };
    const cli = join(root, 'head.json');
    expect(await main(['diff', cli, '--base', cli], io)).toBe(0);
    expect(diff.text).toBe(out.join(''));

    const json = await call(client, 'compare', {
      head: 'head.json',
      format: 'json',
      compression: 'brotli',
      top: 3,
    });
    expect(JSON.parse(json.text)).toHaveProperty('diff.schemaVersion');

    const explained = await call(client, 'explain_package', {
      package: 'react-dom',
      report: 'head.json',
      base: 'head.json',
    });
    const bytes = report.apps[0]?.assets
      ?.flatMap((a) => a.packages ?? [])
      .filter((p) => p.name === 'react-dom')
      .reduce((sum, p) => sum + p.bytes, 0);
    expect(bytes).toBeGreaterThan(0);
    expect(explained.text).toContain('## `react-dom`');
    expect(explained.text).toContain(`${formatBytes(bytes ?? 0)} in 1 file(s)`);
    expect(explained.text).toContain('In the base report:');
    expect(explained.text).toContain('No curated alternatives for `react-dom`');

    const missing = await call(client, 'explain_package', {
      package: 'moment',
      report: 'head.json',
    });
    expect(missing.text).toContain('`moment` is not in the report.');
    expect(missing.text).toContain('Alternatives for `moment`: day.js');
  });

  it('saves to a temporary file by default and passes bundle and archive options', async () => {
    const client = await connect(root);
    const measured = await call(client, 'measure', { path: 'web', config: 'none.json' });
    expect(measured.isError).toBe(true);
    expect(measured.text).toContain('none.json');

    const temp = await call(client, 'measure', { path: 'web', outDir: 'dist' });
    expect(temp.text).toMatch(/Report saved to .*usertax-mcp-.*report\.json/);

    const mobile = await call(client, 'measure', {
      path: 'web',
      framework: 'react-native',
      bundles: ['android=missing.bundle'],
      archives: ['missing.apk'],
    });
    expect(mobile.isError).toBe(true);
  });

  it('returns errors as tool results the assistant can read', async () => {
    const client = await connect(root);
    const nope = await call(client, 'compare', { head: 'nope.json' });
    expect(nope.isError).toBe(true);
    expect(nope.text).toContain('cannot read head report');
    const bad = await call(client, 'explain_package', { package: 'x', report: 'nope.json' });
    expect(bad.isError).toBe(true);
    await writeFile(join(root, 'not-json.json'), '{');
    const notJson = await call(client, 'compare', { head: 'not-json.json' });
    expect(notJson.text).toContain('not valid JSON');
  });

  it('starts from the CLI and stops when the client disconnects', async () => {
    const out: string[] = [];
    const io = { stdout: (t: string) => out.push(t), stderr: () => undefined };
    expect(await main(['mcp', '--help'], io)).toBe(0);
    expect(out.join('')).toContain('"command": "npx"');
    expect(await main(['mcp', 'extra'], io)).toBe(2);

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const running = mcpCommand([], io, { version: '1', cwd: root, env: {} }, serverSide);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(clientSide);
    expect((await call(client, 'alternatives', { package: 'lodash' })).text).toContain('lodash');
    await client.close();
    expect(await running).toBe(0);
  });
});
