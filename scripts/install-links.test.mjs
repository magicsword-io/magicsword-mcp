import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const {name} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const entry = {command: 'npx', args: ['-y', name], env: {MAGICSWORD_BASE_URL: 'https://www.magicsword.io'}};
const buttons = [...readme.matchAll(/\[!\[([^\]]+)\]\([^\n]+?\)\]\((https:\/\/[^\n]+?)\)/g)];

test('public install buttons decode to production stdio launch entries without credentials', () => {
  assert.equal(buttons.length, 3);
  for (const [, label, target] of buttons) {
    const url = new URL(target);
    assert.equal(url.searchParams.get('name'), 'magicsword');
    if (label === 'Install in Cursor') {
      assert.equal(url.hostname, 'cursor.com');
      assert.equal(url.pathname, '/en/install-mcp');
      assert.deepEqual(JSON.parse(Buffer.from(url.searchParams.get('config'), 'base64').toString('utf8')), entry);
    } else {
      const insiders = label === 'Install in VS Code Insiders';
      assert.equal(label, insiders ? 'Install in VS Code Insiders' : 'Install in VS Code');
      assert.equal(url.hostname, insiders ? 'insiders.vscode.dev' : 'vscode.dev');
      assert.equal(url.pathname, '/redirect/mcp/install');
      assert.equal(url.searchParams.get('quality'), insiders ? 'insiders' : null);
      assert.deepEqual(JSON.parse(url.searchParams.get('config')), {type: 'stdio', ...entry});
    }
  }
});

test('manual fallback examples use the respective client schemas and the same safe launch entry', () => {
  const examples = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)].map(([, body]) => JSON.parse(body));
  assert.deepEqual(examples, [{mcpServers: {magicsword: entry}}, {servers: {magicsword: {type: 'stdio', ...entry}}}]);
});
