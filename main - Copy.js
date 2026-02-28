const { app, BrowserWindow, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;

const configPath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(configPath));
  } catch {
    return { width: 420, height: 800 };
  }
}

function saveWindowState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  fs.writeFileSync(configPath, JSON.stringify(bounds));
}

app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('enable-webgl');
app.disableHardwareAcceleration();

function createWindow() {
  const savedState = loadWindowState();

mainWindow = new BrowserWindow({
  x: savedState.x,
  y: savedState.y,
  width: savedState.width,
  height: savedState.height,

  frame: true, // keep native frame for real shadow
  titleBarStyle: 'default',
  autoHideMenuBar: true,

  backgroundColor: '#121212',
  show: false,

  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
});

mainWindow.setVibrancy?.('under-window');
mainWindow.setBackgroundMaterial?.('mica');
if (process.platform === 'win32') {
  mainWindow.setBackgroundMaterial?.('mica');
}

  mainWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  );

  mainWindow.loadURL('https://radio.garden');

mainWindow.webContents.on('did-finish-load', () => {
  mainWindow.webContents.insertCSS(`
    body {
      overflow: hidden;
      border-radius: 12px;
    }
  `);
});

  // Smooth fade-in
  mainWindow.once('ready-to-show', () => {
    mainWindow.setOpacity(0);
    mainWindow.show();

    let opacity = 0;
    const fadeIn = setInterval(() => {
      opacity += 0.05;
      mainWindow.setOpacity(opacity);
      if (opacity >= 1) clearInterval(fadeIn);
    }, 10);
  });

  // Save size/position on move or resize
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Hide instead of close
  mainWindow.on('close', function (event) {
    if (!app.isQuiting) {
      event.preventDefault();
      fadeOutAndHide();
    }
  });
}

function fadeOutAndHide() {
  let opacity = 1;
  const fadeOut = setInterval(() => {
    opacity -= 0.05;
    mainWindow.setOpacity(opacity);
    if (opacity <= 0) {
      clearInterval(fadeOut);
      mainWindow.hide();
      mainWindow.setOpacity(1);
    }
  }, 10);
}

app.whenReady().then(() => {
  createWindow();

  // 🎹 Ctrl+R → Reload
  globalShortcut.register('Control+R', () => {
    mainWindow.reload();
  });

  // 🟢 Tray
  tray = new Tray(path.join(__dirname, 'icon.ico'));

  const trayMenu = Menu.buildFromTemplate([
    {
      label: 'Open Radio Garden',
      click: () => mainWindow.show()
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Radio Garden');
  tray.setContextMenu(trayMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      fadeOutAndHide();
    } else {
      mainWindow.show();
    }
  });
});