'use strict';
// Starts the app. Editors built on Electron (VS Code) export ELECTRON_RUN_AS_NODE
// to their terminals, which would make Electron run as plain Node and fail.
const { spawnSync } = require('node:child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [process.argv[2] || '.', ...process.argv.slice(3)], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
