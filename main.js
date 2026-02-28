const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;
let sleepTimer = null;
let sleepTimerEnd = null;
let sleepCountdownInterval = null;
let alwaysOnTop = false;

const configPath = path.join(app.getPath('userData'), 'window-state.json');

// ── Persistence ───────────────────────────────────────────────────────────────

function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(configPath)); }
  catch { return { width: 420, height: 800 }; }
}

function saveWindowState() {
  if (!mainWindow) return;
  fs.writeFileSync(configPath, JSON.stringify(mainWindow.getBounds()));
}

// ── GPU / Hardware ────────────────────────────────────────────────────────────

app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// ── Sleep Timer ───────────────────────────────────────────────────────────────

function clearSleepTimer() {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  if (sleepCountdownInterval) { clearInterval(sleepCountdownInterval); sleepCountdownInterval = null; }
  sleepTimerEnd = null;
}

function setSleepTimer(minutes) {
  clearSleepTimer();
  sleepTimerEnd = Date.now() + minutes * 60 * 1000;
  sleepTimer = setTimeout(function() {
    sleepTimer = null;
    sleepTimerEnd = null;
    clearInterval(sleepCountdownInterval);
    sleepCountdownInterval = null;
    app.isQuiting = true;
    app.quit();
  }, minutes * 60 * 1000);
  // Update tray label every 30 seconds to show remaining time
  sleepCountdownInterval = setInterval(function() {
    updateTrayMenu();
  }, 30000);
  updateTrayMenu();
}

function promptCustomSleepTimer() {
  const promptWin = new BrowserWindow({
    width: 360,
    height: 210,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    title: 'Sleep Timer',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'prompt-preload.js')
    }
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%; height: 100%;
    background: #181818; color: #e0e0e0;
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .card { width: 100%; padding: 28px 24px 28px; display: flex; flex-direction: column; gap: 14px; align-items: center; }
  label { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #888; align-self: flex-start; }
  input {
    width: 100%; padding: 9px 14px; border-radius: 8px; border: 1px solid #333;
    background: #242424; color: #fff; font-size: 13px; text-align: center; outline: none; transition: border-color 0.15s;
  }
  input::placeholder { color: #555; font-size: 12px; }
  input:focus { border-color: #4caf50; }
  .row { display: flex; gap: 8px; width: 100%; }
  button { flex: 1; padding: 9px 0; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; transition: opacity 0.15s; }
  button:hover { opacity: 0.85; }
  .ok { background: #4caf50; color: #fff; }
  .cancel { background: #2e2e2e; color: #bbb; border: 1px solid #383838; }
</style>
</head>
<body>
<div class="card">
  <label>How long do you want the radio to play?</label>
  <input id="val" type="number" min="1" max="600" placeholder="(in minutes)" autofocus />
  <div class="row">
    <button class="ok" onclick="submit()">Set Timer</button>
    <button class="cancel" onclick="window.promptAPI.cancel()">Cancel</button>
  </div>
</div>
<script>
  function submit() {
    var v = parseInt(document.getElementById('val').value, 10);
    if (v > 0) window.promptAPI.submit(v);
  }
  document.getElementById('val').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') window.promptAPI.cancel();
  });
</script>
</body>
</html>`;

  promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  ipcMain.once('prompt-result', function(event, value) {
    promptWin.close();
    if (value) setSleepTimer(value);
  });

  promptWin.on('closed', function() {
    ipcMain.removeAllListeners('prompt-result');
  });
}


// ── Poller ───────────────────────────────────────────────────────────────────

function startNowPlayingPoller() {
  setInterval(function() {
    if (!mainWindow) return;
  }, 3000);
}

// ── Options ──────────────────────────────────────────────────────────────────


// ── Tray Menu ─────────────────────────────────────────────────────────────────

function updateTrayMenu() {
  var sleepItems = [5, 15, 30, 60, 90].map(function(min) {
    return { label: min + ' minutes', click: function() { setSleepTimer(min); } };
  });
  sleepItems.push({ label: 'Other…', click: function() { promptCustomSleepTimer(); } });

  var trayMenu = Menu.buildFromTemplate([
    {
      label: 'v' + app.getVersion(),
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Open Radio Garden',
      click: function() { fadeIn(); }
    },
    { type: 'separator' },
    {
      label: (function() {
        if (!sleepTimer || !sleepTimerEnd) return 'Sleep Timer';
        var msLeft = sleepTimerEnd - Date.now();
        var minsLeft = Math.max(1, Math.ceil(msLeft / 60000));
        return 'Sleep Timer — ' + minsLeft + ' min left';
      }()),
      submenu: sleepTimer
        ? [{ label: 'Cancel Sleep Timer', click: function() { clearSleepTimer(); updateTrayMenu(); } }]
        : sleepItems
    },
    {
      label: 'Options',
      submenu: [
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: alwaysOnTop,
          click: function() {
            alwaysOnTop = !alwaysOnTop;
            mainWindow.setAlwaysOnTop(alwaysOnTop);
            updateTrayMenu();
          }
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: function() { app.isQuiting = true; app.quit(); }
    }
  ]);

  tray.setContextMenu(trayMenu);
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  var savedState = loadWindowState();

  mainWindow = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    frame: true,
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    backgroundColor: '#121212',
    icon: path.join(__dirname, 'icon.ico'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (mainWindow.setVibrancy) mainWindow.setVibrancy('under-window');
  if (process.platform === 'win32' && mainWindow.setBackgroundMaterial) {
    mainWindow.setBackgroundMaterial('mica');
  }

  mainWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  );

  mainWindow.loadURL('https://radio.garden');

  mainWindow.webContents.on('did-finish-load', function() {
    mainWindow.webContents.insertCSS('body { overflow: hidden; border-radius: 12px; }');
  });

  // F key -> Favourites tab (safe: only when focused, skips text inputs)
  mainWindow.webContents.on('before-input-event', function(event, input) {
    if (
      input.type === 'keyDown' && input.key === 'f' &&
      !input.control && !input.alt && !input.meta && !input.shift
    ) {
      mainWindow.webContents.executeJavaScript(
        '(function() {' +
        '  var tag = document.activeElement && document.activeElement.tagName;' +
        '  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement.isContentEditable) return;' +
        '  var favBtn = Array.from(document.querySelectorAll("nav a, [role=tab], .nav__item"))' +
        '    .find(function(el) { return el.innerText && el.innerText.trim().toLowerCase().includes("favor"); });' +
        '  if (favBtn) favBtn.click();' +
        '})()'
      );
    }
  });

  // Smooth fade-in
  mainWindow.once('ready-to-show', function() {
    mainWindow.setOpacity(0);
    mainWindow.show();
    var opacity = 0;
    var fadeIn = setInterval(function() {
      opacity += 0.05;
      mainWindow.setOpacity(opacity);
      if (opacity >= 1) clearInterval(fadeIn);
    }, 10);
  });

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  mainWindow.on('close', function(event) {
    if (!app.isQuiting) { event.preventDefault(); fadeOutAndHide(); }
  });
}

function fadeIn() {
  mainWindow.setOpacity(0);
  mainWindow.show();
  var opacity = 0;
  var fi = setInterval(function() {
    opacity += 0.05;
    mainWindow.setOpacity(opacity);
    if (opacity >= 1) clearInterval(fi);
  }, 10);
}

function fadeOutAndHide() {
  var opacity = 1;
  var fadeOut = setInterval(function() {
    opacity -= 0.05;
    mainWindow.setOpacity(opacity);
    if (opacity <= 0) {
      clearInterval(fadeOut);
      mainWindow.hide();
      mainWindow.setOpacity(1);
    }
  }, 10);
}

// ── App Ready ─────────────────────────────────────────────────────────────────

// ── Single instance lock ─────────────────────────────────────────────────────

var gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', function() {
    if (mainWindow) {
      if (!mainWindow.isVisible()) fadeIn();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(function() {
  // Block ad/tracker requests at the network level
  var adHosts = [
    '*://googleads.g.doubleclick.net/*',
    '*://pubads.g.doubleclick.net/*',
    '*://securepubads.g.doubleclick.net/*',
    '*://pagead2.googlesyndication.com/*',
    '*://adservice.google.com/*',
    '*://adservice.google.ro/*',
    '*://*.googlesyndication.com/*',
    '*://*.doubleclick.net/*',
    '*://*.addthis.com/*',
    '*://*.adnxs.com/*',
    '*://*.moatads.com/*',
    '*://*.amazon-adsystem.com/*',
    '*://*.outbrain.com/*',
    '*://*.taboola.com/*',
    '*://*.advertising.com/*',
    '*://ads.pubmatic.com/*',
    '*://*.criteo.com/*',
    '*://*.rubiconproject.com/*',
    '*://*.openx.net/*',
    '*://*.adsrvr.org/*',
    '*://*.casalemedia.com/*',
    '*://*.smartadserver.com/*',
    '*://*.adsafeprotected.com/*',
    '*://scdn.cxense.com/*',
    '*://*.cxense.com/*'
  ];

  var session = require('electron').session;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: adHosts },
    function(details, callback) {
      callback({ cancel: true });
    }
  );

  createWindow();
  globalShortcut.register('Control+R', function() { mainWindow.reload(); });


  tray = new Tray(path.join(__dirname, 'icon.ico'));
  tray.setToolTip('Radio Garden');
  updateTrayMenu();

  tray.on('click', function() {
    if (mainWindow.isVisible()) {
      fadeOutAndHide();
    } else {
      fadeIn();
    }
  });

  startNowPlayingPoller();

  // Check for updates on startup
  try {
    var updater = require('electron-updater').autoUpdater;
    updater.setFeedURL({
      provider: 'github',
      owner: 'chillzaurus',
      repo: 'radio-garden-app'
    });
    updater.checkForUpdatesAndNotify();
    updater.on('update-available', function() {
      var { dialog } = require('electron');
      dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: 'A new version is available. It will download in the background and install when you quit the app.',
        buttons: ['OK']
      });
    });
  } catch(e) {}

});
