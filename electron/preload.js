// This line MUST be the first thing to run in the renderer process.
// It creates a 'global' variable that points to 'window', which is what
// libraries like jspdf expect in a browser-like environment.
window.global = window;

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// node-specific APIs without exposing the entire Electron API.
contextBridge.exposeInMainWorld(
  'electronAPI', {
    getAudioBaseUrl: () => ipcRenderer.sendSync('get-audio-base-url')
  }
);
