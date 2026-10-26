import { rmSync } from 'node:fs';

// Only generated TypeScript output, rooted beside this script.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
