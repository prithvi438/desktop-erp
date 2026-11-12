'use strict';
// This build runs under Electron's Node runtime; packaging needs ordinary fs semantics.
process.noAsar = true;
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');

build({
  projectDir: path.join(__dirname, '..'),
  config: path.join(__dirname, '..', 'electron-builder.yml'),
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  publish: 'never',
}).then(artifacts => artifacts.forEach(file => console.log(file))).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
