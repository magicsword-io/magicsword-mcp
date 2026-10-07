import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Acceptance criteria: docs/CLIENT_SETUP.md, SETUP-01 through SETUP-04.
// Every child uses a disposable home and fake keys; no real client is invoked.
const server = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const production = 'https://www.magicsword.io';
const preview = 'https://old-preview-never-display.example';
const key = 'msk_fixture_saved_0123456789abcdef';
const envKey = 'msk_fixture_environment_0123456789abcdef';
const argKey = 'msk_fixture_argument_0123456789abcdef';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'magicsword-configure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  mkdirSync(home);
  const config = join(home, '.magicsword', 'mcp.json');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: join(home, '.config'), CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), MAGICSWORD_CONFIG: config, PATH: bin };
  for (const name of Object.keys(env)) {
    if ((name.startsWith('MAGICSWORD_') && name !== 'MAGICSWORD_CONFIG') || name === 'NODE_OPTIONS') delete env[name];
  }
  const put = (path, contents) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  const save = (data = { apiKey: key, baseUrl: preview }) => put(config, JSON.stringify(data));
  const run = (args = [], extraEnv = {}) => {
    const result = spawnSync(process.execPath, [server, 'configure', '--non-interactive', ...args], {
      cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'configure should finish without a signal');
    return { ...result, output: result.stdout + result.stderr };
  };
  return { root, home, config, bin, env, put, save, run };
}

function privateFile(path) {
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600, `${path} must be private`);
}

function noSecrets(output) {
  for (const value of [preview, key, envKey, argKey, 'msk_fixt']) assert.equal(output.includes(value), false, 'output must not disclose saved origins or any API-key prefix');
}

function registration(entry, config, baseUrl = production) {
  assert.equal(entry.command, process.execPath);
  assert(isAbsolute(entry.command));
  assert.deepEqual(entry.args, [server]);
  assert(isAbsolute(entry.args[0]));
  assert.equal(entry.env.MAGICSWORD_CONFIG, config);
  assert.equal(entry.env.MAGICSWORD_BASE_URL, baseUrl);
  assert.equal(JSON.stringify(entry).includes('msk_'), false, 'client configuration must not embed credentials');
}

test('SETUP-01 migrates a saved preview to production without printing the origin or key', (t) => {
  const f = fixture(t);
  f.save();
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(readFileSync(f.config, 'utf8')), { apiKey: key, baseUrl: production });
  privateFile(f.config);
  noSecrets(result.output);
});

for (const [name, args, environment, expected] of [
  ['environment key', [], { MAGICSWORD_API_KEY: envKey }, envKey],
  ['legacy explicit key', ['--api-key', argKey], {}, argKey],
  ['explicit key over environment', ['--api-key', argKey], { MAGICSWORD_API_KEY: envKey }, argKey],
]) {
  test(`SETUP-02 accepts ${name} without disclosure`, (t) => {
    const f = fixture(t);
    const result = f.run(args, environment);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(JSON.parse(readFileSync(f.config, 'utf8')), { apiKey: expected, baseUrl: production });
    privateFile(f.config);
    noSecrets(result.output);
  });
}

test('SETUP-01 ignores a preview environment origin unless --base-url is explicit', (t) => {
  const f = fixture(t);
  f.save();
  const result = f.run([], { MAGICSWORD_BASE_URL: preview });
  assert.equal(result.status, 0, result.output);
  assert.equal(JSON.parse(readFileSync(f.config, 'utf8')).baseUrl, production);
  noSecrets(result.output);
});

test('SETUP-01 honors an explicit valid origin', (t) => {
  const f = fixture(t);
  f.save();
  const result = f.run(['--base-url', 'https://custom.example/']);
  assert.equal(result.status, 0, result.output);
  assert.equal(JSON.parse(readFileSync(f.config, 'utf8')).baseUrl, 'https://custom.example');
  noSecrets(result.output);
});

for (const args of [[], ['--client', 'manual']]) {
  test(`SETUP-03 unattended ${args.length ? 'manual' : 'default'} setup writes only credentials and prints an absolute launch configuration`, (t) => {
    const f = fixture(t);
    f.save();
    const result = f.run(args);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(readdirSync(f.home), ['.magicsword']);
    assert.deepEqual(readdirSync(dirname(f.config)), ['mcp.json']);
    const start = result.stdout.indexOf('{');
    const end = result.stdout.lastIndexOf('}');
    assert(start >= 0 && end > start, 'manual setup must supply a JSON client snippet');
    registration(JSON.parse(result.stdout.slice(start, end + 1)).mcpServers.magicsword, f.config);
    noSecrets(result.output);
  });
}

for (const client of ['claude-desktop', 'cursor']) {
  test(`SETUP-03 ${client} writes its standard user configuration path`, (t) => {
    const f = fixture(t);
    f.save();
    const target = client === 'cursor'
      ? join(f.home, '.cursor', 'mcp.json')
      : process.platform === 'darwin'
        ? join(f.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : process.platform === 'win32'
          ? join(f.env.APPDATA, 'Claude', 'claude_desktop_config.json')
          : join(f.home, '.config', 'Claude', 'claude_desktop_config.json');
    const result = f.run(['--client', client]);
    assert.equal(result.status, 0, result.output);
    registration(JSON.parse(readFileSync(target, 'utf8')).mcpServers.magicsword, f.config);
    noSecrets(result.output);
  });

  test(`SETUP-04 ${client} merges unrelated JSON and creates an exact private backup`, (t) => {
    const f = fixture(t);
    f.save();
    const target = join(f.home, 'custom client', 'settings.json');
    const original = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: '/other/server', env: { KEEP: 'yes' } }, magicsword: { command: 'outdated' } } }, null, 4) + '\n';
    f.put(target, original);
    chmodSync(target, 0o644);
    const result = f.run(['--client', client, '--client-config', target, '--base-url', 'https://custom.example']);
    assert.equal(result.status, 0, result.output);
    const after = JSON.parse(readFileSync(target, 'utf8'));
    assert.equal(after.theme, 'dark');
    assert.deepEqual(after.mcpServers.other, JSON.parse(original).mcpServers.other);
    registration(after.mcpServers.magicsword, f.config, 'https://custom.example');
    const backups = readdirSync(dirname(target)).filter((name) => name.startsWith(`${basename(target)}.magicsword-backup.`));
    assert.equal(backups.length, 1, 'existing client file must have exactly one backup');
    assert.match(backups[0].slice(`${basename(target)}.magicsword-backup.`.length), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const backup = join(dirname(target), backups[0]);
    assert.equal(readFileSync(backup, 'utf8'), original);
    privateFile(backup);
    noSecrets(result.output);
  });

  test(`SETUP-04 ${client} creates a missing JSON configuration`, (t) => {
    const f = fixture(t);
    f.save();
    const target = join(f.home, 'new', 'settings.json');
    const result = f.run(['--client', client, '--client-config', target]);
    assert.equal(result.status, 0, result.output);
    registration(JSON.parse(readFileSync(target, 'utf8')).mcpServers.magicsword, f.config);
    assert.deepEqual(readdirSync(dirname(target)), ['settings.json']);
  });

  for (const original of ['{broken', '[]', 'null', '{"mcpServers":[]}', '{"mcpServers":"bad"}']) {
    test(`SETUP-04 ${client} rejects invalid client structure ${original} without overwriting it`, (t) => {
      const f = fixture(t);
      f.save();
      const target = join(f.home, 'client', 'settings.json');
      f.put(target, original);
      const result = f.run(['--client', client, '--client-config', target]);
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(target, 'utf8'), original);
      assert.deepEqual(readdirSync(dirname(target)), ['settings.json']);
      noSecrets(result.output);
    });
  }
}

function fakeCli(f, name, exitCode = 0) {
  const capture = join(f.root, 'cli-arguments.json');
  const script = join(f.bin, name);
  f.put(script, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify(args));
const separator = args.indexOf('--');
const env = {};
for (let i = 0; i < separator; i++) {
  if (args[i] === '--env') {
    const pair = args[++i];
    const equals = pair.indexOf('=');
    env[pair.slice(0, equals)] = pair.slice(equals + 1);
  }
}
const definition = { command: args[separator + 1], args: args.slice(separator + 2), env };
const target = ${JSON.stringify(name)} === 'claude'
  ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
  : path.join(process.env.CODEX_HOME, 'config.toml');
fs.mkdirSync(path.dirname(target), { recursive: true });
// Model a CLI migration dropping unknown fields, or partially writing before failure.
const contents = ${JSON.stringify(name)} === 'claude'
  ? JSON.stringify({ mcpServers: { magicsword: definition } })
  : '[mcp_servers.magicsword]\\ncommand = ' + JSON.stringify(definition.command) + '\\nargs = ' + JSON.stringify(definition.args) + '\\n[mcp_servers.magicsword.env]\\n' + Object.entries(env).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join('\\n') + '\\n';
fs.writeFileSync(target, contents);
process.stdout.write('RAW_CLIENT_OUTPUT_${key}');
process.stderr.write('RAW_CLIENT_ERROR_${preview}');
process.exit(${exitCode});
`);
  chmodSync(script, 0o755);
  return capture;
}

for (const [client, command] of [['codex', 'codex'], ['claude-code', 'claude']]) {
  test(`SETUP-04 ${client} delegates to its official CLI with absolute launch paths and no credentials`, (t) => {
    const f = fixture(t);
    f.save();
    const capture = fakeCli(f, command);
    const result = f.run(['--client', client]);
    assert.equal(result.status, 0, result.output);
    const args = JSON.parse(readFileSync(capture, 'utf8'));
    const separator = args.indexOf('--');
    assert(separator > 0);
    assert.deepEqual(args.slice(separator + 1), [process.execPath, server]);
    const options = args.slice(0, separator);
    const env = [];
    for (let i = options.length - 2; i >= 0; i--) {
      if (options[i] === '--env') env.push(...options.splice(i, 2).slice(1));
    }
    assert.deepEqual(env.sort(), [`MAGICSWORD_CONFIG=${f.config}`, `MAGICSWORD_BASE_URL=${production}`].sort());
    assert.deepEqual(options, client === 'codex' ? ['mcp', 'add', 'magicsword'] : ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'magicsword']);
    assert.equal(JSON.stringify(args).includes('msk_'), false);
    noSecrets(result.output);
    assert.doesNotMatch(result.output, /RAW_CLIENT_(?:OUTPUT|ERROR)/);
  });

  test(`SETUP-04 ${client} registers the explicit custom origin`, (t) => {
    const f = fixture(t);
    f.save();
    const capture = fakeCli(f, command);
    const result = f.run(['--client', client, '--base-url', 'https://custom.example']);
    assert.equal(result.status, 0, result.output);
    const args = JSON.parse(readFileSync(capture, 'utf8'));
    const origin = args.indexOf('MAGICSWORD_BASE_URL=https://custom.example');
    assert(origin > 0);
    assert.equal(args[origin - 1], '--env');
    noSecrets(result.output);
  });

  test(`SETUP-04 ${client} sanitizes failed CLI output`, (t) => {
    const f = fixture(t);
    f.save();
    fakeCli(f, command, 7);
    const result = f.run(['--client', client]);
    assert.notEqual(result.status, 0);
    noSecrets(result.output);
    assert.doesNotMatch(result.output, /RAW_CLIENT_(?:OUTPUT|ERROR)/);
    const target = client === 'codex' ? join(f.env.CODEX_HOME, 'config.toml') : join(f.env.CLAUDE_CONFIG_DIR, '.claude.json');
    assert.equal(existsSync(target), false, 'failed first-time registration must remove partial client configuration');
  });

  test(`SETUP-04 ${client} restores exact original settings after a CLI partial write and failure`, (t) => {
    const f = fixture(t);
    f.save();
    const target = client === 'codex' ? join(f.env.CODEX_HOME, 'config.toml') : join(f.env.CLAUDE_CONFIG_DIR, '.claude.json');
    const original = client === 'codex' ? '# preserved comment\nmodel = "test-model"\n' : '{ "theme": "dark", "mcpServers": { "other": { "command": "/other/server" } } }\n';
    f.put(target, original);
    fakeCli(f, command, 7);
    const result = f.run(['--client', client]);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(target, 'utf8'), original);
    privateFile(target);
    const backups = readdirSync(dirname(target)).filter((name) => name.startsWith(`${basename(target)}.magicsword-backup.`));
    assert.equal(backups.length, 1);
    const backup = join(dirname(target), backups[0]);
    assert.equal(readFileSync(backup, 'utf8'), original);
    privateFile(backup);
    noSecrets(result.output);
  });

  test(`SETUP-04 ${client} reports an unavailable CLI without exposing credentials`, (t) => {
    const f = fixture(t);
    f.save();
    const result = f.run(['--client', client]);
    assert.notEqual(result.status, 0);
    noSecrets(result.output);
  });
}

for (const original of ['{broken', '[]', 'null', '{"mcpServers":[]}', '{"mcpServers":null}', '{"mcpServers":"bad"}']) {
  test(`SETUP-04 claude-code rejects invalid existing structure ${original} before CLI invocation or backup`, (t) => {
    const f = fixture(t);
    f.save();
    const target = join(f.env.CLAUDE_CONFIG_DIR, '.claude.json');
    f.put(target, original);
    const capture = fakeCli(f, 'claude');
    const result = f.run(['--client', 'claude-code']);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(capture), false, 'invalid configuration must never reach the CLI');
    assert.equal(readFileSync(target, 'utf8'), original);
    assert.deepEqual(readdirSync(dirname(target)), ['.claude.json']);
    noSecrets(result.output);
  });
}

test('SETUP-04 claude-code preserves unrelated root settings and servers dropped by a successful CLI migration', (t) => {
  const f = fixture(t);
  f.save();
  const target = join(f.env.CLAUDE_CONFIG_DIR, '.claude.json');
  const before = { theme: 'dark', projects: { '/example': { trust: true } }, mcpServers: { other: { command: '/other/server', env: { KEEP: 'yes' } }, magicsword: { command: 'obsolete' } } };
  const original = JSON.stringify(before, null, 4) + '\n';
  f.put(target, original);
  fakeCli(f, 'claude');
  const result = f.run(['--client', 'claude-code']);
  assert.equal(result.status, 0, result.output);
  const after = JSON.parse(readFileSync(target, 'utf8'));
  assert.equal(after.theme, before.theme);
  assert.deepEqual(after.projects, before.projects);
  assert.deepEqual(after.mcpServers.other, before.mcpServers.other);
  registration(after.mcpServers.magicsword, f.config);
  const backups = readdirSync(dirname(target)).filter((name) => name.startsWith('.claude.json.magicsword-backup.'));
  assert.equal(backups.length, 1);
  const backup = join(dirname(target), backups[0]);
  assert.equal(readFileSync(backup, 'utf8'), original);
  privateFile(backup);
  noSecrets(result.output);
});

for (const args of [['--unknown'], ['--api-key'], ['--base-url'], ['--client'], ['--client-config'], ['--client', 'unknown'], ['--base-url', '--client', 'manual'], ['--client', 'codex', '--client-config', 'unused.json'], ['--client', 'claude-code', '--client-config', 'unused.json'], ['--client', 'manual', '--client-config', 'unused.json']]) {
  test(`SETUP-03 rejects invalid arguments ${args.join(' ')} with exit 2`, (t) => {
    const f = fixture(t);
    f.save();
    const before = readFileSync(f.config, 'utf8');
    const result = f.run(args);
    assert.equal(result.status, 2, result.output);
    assert.equal(readFileSync(f.config, 'utf8'), before, 'invalid arguments must not mutate credentials');
    noSecrets(result.output);
  });
}

test('SETUP-02 missing credentials fail without creating configuration', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 2, result.output);
  assert.equal(existsSync(f.config), false);
});

// Python's standard-library PTY exercises actual terminal echo and Ctrl-C,
// which a piped stdin cannot reproduce. Windows requires a separate ConPTY guard.
const ptyDriver = String.raw`
import errno, json, os, pty, select, signal, sys, termios, time

request = json.load(sys.stdin)
pid, master = pty.fork()
if pid == 0:
    os.execv(request['command'], [request['command'], *request['args']])

transcript = bytearray()
deadline = time.monotonic() + 8
sent = False
status = None
eof = False
try:
    while status is None or not eof:
        if time.monotonic() >= deadline:
            raise RuntimeError('PTY configure did not finish within eight seconds')
        if not eof and select.select([master], [], [], 0.02)[0]:
            try:
                chunk = os.read(master, 65536)
                if chunk:
                    transcript.extend(chunk)
                else:
                    eof = True
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                eof = True
        if not sent and request['prompt'].encode() in transcript:
            # The prompt is printed before readline enables raw mode. Wait for
            # raw mode to avoid injecting a key while the terminal still echoes.
            flags = termios.tcgetattr(master)[3]
            if not flags & (termios.ECHO | termios.ICANON):
                os.write(master, request['input'].encode())
                sent = True
        if status is None:
            ended, wait_status = os.waitpid(pid, os.WNOHANG)
            if ended:
                status = os.waitstatus_to_exitcode(wait_status)
    print(json.dumps({'status': status, 'sent': sent, 'output': transcript.decode('utf-8', errors='replace')}))
finally:
    if status is None:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
    os.close(master)
`;

function runPty(f, args, prompt, input, extraEnv = {}) {
  // Resolve Python before switching to the deliberately empty fixture PATH.
  const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 3_000 });
  assert.ifError(python.error);
  assert.equal(python.status, 0, 'Python 3 is required for POSIX terminal regression checks');
  const result = spawnSync(python.stdout.trim(), ['-c', ptyDriver], {
    cwd: f.root,
    env: { ...f.env, ...extraEnv },
    input: JSON.stringify({ command: process.execPath, args: [server, 'configure', ...args], prompt, input }),
    encoding: 'utf8',
    timeout: 12_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const terminal = JSON.parse(result.stdout);
  assert.equal(terminal.sent, true, 'the expected prompt must be reached and exercised');
  return terminal;
}

const ptyOptions = {
  skip: process.platform === 'win32' ? 'Python POSIX PTY is unavailable on Windows; ConPTY coverage is required separately.' : false,
  timeout: 20_000,
};

test('SETUP-02 real TTY hides API-key input and completes manual setup', ptyOptions, (t) => {
  const f = fixture(t);
  const result = runPty(f, ['--client', 'manual'], 'MagicSword API key (hidden): ', `${key}\n`);
  assert.equal(result.status, 0, result.output);
  noSecrets(result.output);
  assert.deepEqual(JSON.parse(readFileSync(f.config, 'utf8')), { apiKey: key, baseUrl: production });
  privateFile(f.config);
});

test('SETUP-02 Ctrl-C at the real TTY key prompt exits 2 without saving credentials', ptyOptions, (t) => {
  const f = fixture(t);
  const result = runPty(f, ['--client', 'manual'], 'MagicSword API key (hidden): ', '\u0003');
  assert.equal(result.status, 2, result.output);
  assert.equal(existsSync(f.config), false);
  assert.deepEqual(readdirSync(f.home), []);
  noSecrets(result.output);
});

test('SETUP-03 Ctrl-C at the real TTY client prompt exits 2 without saving credentials', ptyOptions, (t) => {
  const f = fixture(t);
  const result = runPty(f, [], 'Choose 1–5: ', '\u0003', { MAGICSWORD_API_KEY: envKey });
  assert.equal(result.status, 2, result.output);
  assert.equal(existsSync(f.config), false);
  assert.deepEqual(readdirSync(f.home), []);
  noSecrets(result.output);
});
