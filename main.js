const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;
let sleepTimer = null;
let sleepTimerEnd = null;
let sleepCountdownInterval = null;
let alwaysOnTop = false;
let promptWin = null;

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
  
  sleepCountdownInterval = setInterval(function() {
    updateTrayMenu();
  }, 30000);
  updateTrayMenu();
}

function promptCustomSleepTimer() {
  if (promptWin && !promptWin.isDestroyed()) { promptWin.focus(); return; }

  promptWin = new BrowserWindow({
    width: 340,
    height: 210,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#191919',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  var html = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>',
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
    'html, body { width: 100%; height: 100%; background: #191919; color: #e0e0e0;',
    '  font-family: system-ui, -apple-system, sans-serif; overflow: hidden;',
    '  display: flex; align-items: center; justify-content: center;',
    '  padding: 36px 0 16px; -webkit-app-region: drag; }',
    '.x-btn { position: fixed; top: 10px; right: 12px; background: none; border: none;',
    '  color: #555; font-size: 16px; cursor: pointer; line-height: 1;',
    '  padding: 2px 5px; border-radius: 4px; transition: color 0.15s; -webkit-app-region: no-drag; }',
    '.x-btn:hover { color: #fff; }',
    '.card { width: 100%; padding: 0 20px; display: flex; flex-direction: column;',
    '  gap: 14px; align-items: center; -webkit-app-region: no-drag; }',
    'label { font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase;',
    '  color: #888; text-align: center; width: 100%; }',
    'input { width: 100%; padding: 9px 14px; border-radius: 8px; border: 1px solid #333;',
    '  background: #242424; color: #fff; font-size: 13px; text-align: center;',
    '  outline: none; transition: border-color 0.15s; -webkit-app-region: no-drag; }',
    'input::placeholder { color: #555; font-size: 12px; }',
    'input:focus { border-color: #00c864; }',
    '.row { display: flex; gap: 8px; width: 100%; -webkit-app-region: no-drag; }',
    'button { flex: 1; padding: 9px 0; border-radius: 8px; border: none; cursor: pointer;',
    '  font-size: 13px; font-weight: 600; transition: opacity 0.15s; -webkit-app-region: no-drag; }',
    'button:hover { opacity: 0.85; }',
    '.ok { background: #00c864; color: #fff; }',
    '.cancel { background: #2e2e2e; color: #bbb; border: 1px solid #383838; }',
    '</style></head><body>',
    '<button class="x-btn" id="x-btn">&#x2715;</button>',
    '<div class="card">',
    '  <label>How long do you want the radio to play?</label>',
    '  <input id="val" type="number" min="1" max="600" placeholder="(in minutes)" autofocus />',
    '  <div class="row">',
    '    <button class="ok" id="ok-btn">Set Timer</button>',
    '    <button class="cancel" id="cancel-btn">Cancel</button>',
    '  </div>',
    '</div>',
    '<script>',
    '  var { ipcRenderer } = require("electron");',
    '  function submit() {',
    '    var v = parseInt(document.getElementById("val").value, 10);',
    '    if (v > 0) ipcRenderer.send("prompt-result", v);',
    '  }',
    '  document.getElementById("ok-btn").addEventListener("click", submit);',
    '  document.getElementById("cancel-btn").addEventListener("click", function() { ipcRenderer.send("prompt-result", null); });',
    '  document.getElementById("x-btn").addEventListener("click", function() { ipcRenderer.send("prompt-result", null); });',
    '  document.getElementById("val").addEventListener("keydown", function(e) {',
    '    if (e.key === "Enter") submit();',
    '    if (e.key === "Escape") ipcRenderer.send("prompt-result", null);',
    '  });',
    '<\/script></body></html>'
  ].join("\n");

  promptWin.loadURL("about:blank");
  promptWin.webContents.on("did-finish-load", function() {
    promptWin.webContents.executeJavaScript(
      "document.open(); document.write(" + JSON.stringify(html) + "); document.close();"
    );
  });

  ipcMain.once("prompt-result", function(event, value) {
    if (promptWin && !promptWin.isDestroyed()) promptWin.close();
    if (value) setSleepTimer(value);
  });

  promptWin.on("closed", function() {
    ipcMain.removeAllListeners("prompt-result");
    promptWin = null;
  });
}
// ── Poller ───────────────────────────────────────────────────────────────────

function startNowPlayingPoller() {
  setInterval(function() {
    if (!mainWindow) return;
  }, 3000);
}

// ── About Window ─────────────────────────────────────────────────────────────

var aboutWindow = null;

function showAbout() {
  if (aboutWindow && !aboutWindow.isDestroyed()) { aboutWindow.focus(); return; }

  aboutWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  var firstLaunchPath = path.join(app.getPath('userData'), 'show-about-on-launch.json');
  var showOnLaunch = true;
  try { showOnLaunch = JSON.parse(fs.readFileSync(firstLaunchPath)).show; } catch(e) {}

  var html = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<style>',
    '  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
    '  html, body { width: 100%; height: 100%; background: #111; color: #e0e0e0;',
    '    font-family: "Segoe UI", system-ui, sans-serif; overflow: hidden; -webkit-app-region: drag; }',
    '  .wrap { display: flex; flex-direction: column; align-items: center;',
    '    justify-content: space-between; height: 100%; padding: 32px 32px 24px; }',
    '  .top { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }',
    '  .logo { width: 52px; height: 52px; border-radius: 14px; background: #00c864;',
    '    display: flex; align-items: center; justify-content: center; }',
    '  .logo svg { width: 28px; height: 28px; fill: #111; }',
    '  h1 { font-size: 22px; font-weight: 600; color: #fff; letter-spacing: -0.3px; }',
    '  .tagline { font-size: 13px; color: #777; font-weight: 300; text-align: center; line-height: 1.5; }',
    '  .divider { width: 100%; height: 1px; background: rgba(255,255,255,0.07); margin: 4px 0; }',
    '  .shortcuts { width: 100%; background: #2b2b2b; border-radius: 10px;',
    '    border: 1px solid rgba(255,255,255,0.06); overflow: hidden; }',
    '  .shortcuts-title { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;',
    '    color: #888; padding: 12px 16px 8px; }',
    '  .shortcut { display: flex; justify-content: space-between; align-items: center;',
    '    padding: 9px 16px; border-top: 1px solid rgba(255,255,255,0.04); }',
    '  .shortcut:first-of-type { border-top: none; }',
    '  .shortcut-desc { font-size: 13px; color: #aaa; }',
    '  .key { background: #222; border: 1px solid #333; border-radius: 5px;',
    '    padding: 3px 8px; font-size: 11px; color: #ccc; font-family: monospace; }',
    '  .disclaimer { font-size: 11px; color: #444; text-align: center; line-height: 1.6; padding: 0 8px; }',
    '  .bottom { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }',
    '  .toggle-row { display: flex; align-items: center; justify-content: center;',
    '    gap: 10px; -webkit-app-region: no-drag; }',
    '  .toggle-label { font-size: 12px; color: #555; }',
    '  .toggle { position: relative; width: 34px; height: 18px; cursor: pointer; }',
    '  .toggle input { opacity: 0; width: 0; height: 0; }',
    '  .slider { position: absolute; inset: 0; background: #2a2a2a; border-radius: 18px;',
    '    border: 1px solid #333; transition: 0.2s; }',
    '  .slider::before { content: ""; position: absolute; width: 12px; height: 12px;',
    '    left: 2px; top: 2px; background: #555; border-radius: 50%; transition: 0.2s; }',
    '  input:checked + .slider { background: #00c864; border-color: #00c864; }',
    '  input:checked + .slider::before { transform: translateX(16px); background: #111; }',
    '  .made-by { font-size: 11px; color: #666; }',
    '  .made-by span { color: #00c864; }',
    '  .gh-link { font-size: 11px; color: #444; text-decoration: none;',
    '    border-bottom: 1px solid #333; padding-bottom: 1px; transition: color 0.15s; -webkit-app-region: no-drag; }',
    '  .gh-link:hover { color: #00c864; border-color: #00c864; }',
    '  .x-btn { position: fixed; top: 12px; right: 14px; -webkit-app-region: no-drag;',
    '    background: none; border: none; color: #555; font-size: 18px; cursor: pointer;',
    '    line-height: 1; padding: 2px 6px; border-radius: 4px; transition: color 0.15s; }',
    '  .x-btn:hover { color: #fff; }',
    '  .close-btn { -webkit-app-region: no-drag; background: #00c864; color: #fff;',
    '    border: none; border-radius: 8px; padding: 9px 32px; font-size: 13px;',
    '    font-weight: 600; cursor: pointer; font-family: inherit;',
    '    transition: opacity 0.15s; }',
    '  .close-btn:hover { opacity: 0.85; }',
    '</style></head><body>',
    '  <button class="x-btn" id="x-btn">&#x2715;</button>',
    '<div class="wrap">',
    '  <div class="top">',
    '    <div class="logo">',
    '      <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zm0 2a7 7 0 0 1 6.33 4H5.67A7 7 0 0 1 12 5zm-7 7a7 7 0 0 1 .08-1h13.84A7 7 0 0 1 19 12H5zm0 1h14a7 7 0 0 1-6.17 3.64C9.5 16.5 8 15 8 13H6a6 6 0 0 0 .17 1H5a7 7 0 0 1-.02-.44L5 13z"/></svg>',
    '    </div>',
    '    <h1>Radio Garden</h1>',
    '<p class="tagline">A minimal desktop wrapper for radio.garden</p>',
    '    <div class="divider"></div>',
    '    <div class="shortcuts">',
    '      <div class="shortcuts-title">Keyboard Shortcuts</div>',
    '      <div class="shortcut"><span class="shortcut-desc">Open Favorites</span><span class="key">F</span></div>',
    '      <div class="shortcut"><span class="shortcut-desc">Play / Pause</span><span class="key">Space</span></div>',
    '      <div class="shortcut"><span class="shortcut-desc">Reload</span><span class="key">Ctrl+R</span></div>',
    '    </div>',
    '  </div>',
    '  <div class="bottom">',
    '    <div class="toggle-row">',
    '      <span class="toggle-label">Show on launch</span>',
    '      <label class="toggle">',
    '        <input type="checkbox" id="show-toggle" ' + (showOnLaunch ? 'checked' : '') + '>',
    '        <span class="slider"></span>',
    '      </label>',
    '    </div>',
    '    <button class="close-btn" id="close-btn">Close</button>',
    '    <div class="made-by">made by <span>unugeorge</span> &nbsp;&middot;&nbsp; v' + app.getVersion() + ' &nbsp;&middot;&nbsp; 2026</div>',
    '    <p class="disclaimer">This is an independent project and is not affiliated with,<br>endorsed by, or associated with Radio Garden.</p>',
    '  </div>',
    '</div>',
    '<script>',
    '  var { ipcRenderer } = require("electron");',
    '  document.getElementById("close-btn").addEventListener("click", function() { window.close(); });',
    '  document.getElementById("x-btn").addEventListener("click", function() { window.close(); });',
    '  document.getElementById("show-toggle").addEventListener("change", function() {',
    '    ipcRenderer.send("about-toggle-launch", this.checked);',
    '  });',
    '<\/script>',
    '</body></html>'
  ].join('\n');

  aboutWindow.loadURL('about:blank');
  aboutWindow.webContents.on('did-finish-load', function() {
    aboutWindow.webContents.executeJavaScript(
      'document.open(); document.write(' + JSON.stringify(html) + '); document.close();'
    );
  });

  aboutWindow.on('closed', function() { aboutWindow = null; });
}

function checkFirstLaunch() {
  var firstLaunchPath = path.join(app.getPath('userData'), 'show-about-on-launch.json');
  try {
    var data = JSON.parse(fs.readFileSync(firstLaunchPath));
    if (data.show) showAbout();
  } catch(e) {
    fs.writeFileSync(firstLaunchPath, JSON.stringify({ show: true }));
    showAbout();
  }
}

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
        return 'Sleep Timer: ' + minsLeft + ' min left';
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
    {
      label: 'About',
      click: function() { showAbout(); }
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

  mainWindow.once('ready-to-show', function() {
    mainWindow.setOpacity(0);
    mainWindow.show();
    var opacity = 0;
    var fadeInInt = setInterval(function() {
      opacity += 0.05;
      mainWindow.setOpacity(opacity);
      if (opacity >= 1) clearInterval(fadeInInt);
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
  checkFirstLaunch();

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

  ipcMain.on('about-toggle-launch', function(event, value) {
    var firstLaunchPath = path.join(app.getPath('userData'), 'show-about-on-launch.json');
    fs.writeFileSync(firstLaunchPath, JSON.stringify({ show: value }));
  });
});