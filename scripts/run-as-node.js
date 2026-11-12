'use strict';
// Runs a script on the Node.js bundled inside Electron, so tests use the same
// runtime (and the same built-in SQLite) as the app.
const { spawnSync } = require('node:child_process');

const result = spawnSync(require('electron'), process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status ?? 1);
