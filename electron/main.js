const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
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

  // Create Custom Menu
  const template = [
    // { role: 'fileMenu' },
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About SWIR',
          click: async () => {
            const version = app.getVersion();
            await dialog.showMessageBox(win, {
              type: 'info',
              title: 'About SWIR',
              message: `SWIR - Rose Hill Clinical Version\nVersion: ${version}`,
              detail: 'Built for HearingLife\n\n© 2026 Euphonic Euphemism',
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

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
