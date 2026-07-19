#!/usr/bin/env node
/**
 * Copies the shared business-rules module from packages/shared/src into
 * apps/mobile/src/shared. Metro does not reliably follow workspace symlinks,
 * so the mobile app keeps a checked-in copy. Run after any change to the
 * shared package:  npm run sync-shared
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', '..', 'packages', 'shared', 'src');
const DEST = path.resolve(__dirname, '..', 'src', 'shared');

if (!fs.existsSync(SRC)) {
  console.error(`sync-shared: source not found: ${SRC}`);
  process.exit(1);
}
fs.mkdirSync(DEST, { recursive: true });

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts'));
for (const f of files) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
  console.log(`sync-shared: copied ${f}`);
}
console.log(`sync-shared: ${files.length} file(s) -> ${path.relative(process.cwd(), DEST)}`);
