import { chmodSync } from 'node:fs';

if (process.platform !== 'win32') {
  chmodSync(new URL('../dist/index.js', import.meta.url), 0o755);
}
