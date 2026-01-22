const { app, BrowserWindow } = require('electron');
const path = require('path');

// This check is the key. It will be false in development and true in production.
const isPackaged = app.isPackaged;

// Define a global variable to hold the path to your audio files
global.audioPath = isPackaged
  ? path.join(process.resourcesPath, 'app', 'audio_output')
  : path.join(__dirname, '..', 'audio_output');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load the app
  if (!isPackaged) {
    // In development (when isPackaged is false), load from the dev server
    win.loadURL('http://localhost:3001');
  } else {
    // In production (when isPackaged is true), load the bundled file
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
