const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const url = require('url');

const isPackaged = app.isPackaged;

const audioBaseUrl = isPackaged
  ? url.format({
      pathname: path.join(app.getAppPath(), 'audio_output'),
      protocol: 'file:',
      slashes: true
    })
  : 'http://localhost:3001/audio_output';

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // Recommended to be false
      contextIsolation: true, // Recommended to be true
      preload: path.join(__dirname, 'preload.js') // Use the preload script
    },
  });

  // Listen for the 'get-audio-base-url' message from the renderer process
  ipcMain.on('get-audio-base-url', (event) => {
    event.returnValue = audioBaseUrl;
  });

  // Load the app
  if (!isPackaged) {
    win.loadURL('http://localhost:3001');
    win.webContents.openDevTools();
  } else {
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
