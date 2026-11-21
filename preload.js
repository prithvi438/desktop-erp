'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// One function per channel: sends a method name and its arguments to the main
// process and throws the message it answers with when the request fails.
const channel = (name) => async (method, args) => {
  const reply = await ipcRenderer.invoke(name, method, args);
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
};

contextBridge.exposeInMainWorld('books', { call: channel('books'), quit: () => ipcRenderer.send('quit') });
contextBridge.exposeInMainWorld('files', { call: channel('files') });
