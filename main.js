const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const DiscordRPC = require('discord-rpc');

let mainWindow;
let tray;
let sleepTimer = null;
let sleepTimerEnd = null;
let sleepCountdownInterval = null;
let alwaysOnTop = false;
let stationHistory = [];
let listeningStats = {};
let promptWin = null;
let discordClient = null;
let discordReady = false;
let discordEnabled = true;
let lastStation = null;

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
var aboutWindowReady = false;

function showAbout() {
  if (aboutWindow && !aboutWindow.isDestroyed()) { aboutWindow.focus(); return; }

  aboutWindow = new BrowserWindow({
    width: 420,
    height: 620,
    width: 620,
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
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>',
    '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }',
    'html, body { width: 100%; height: 100%; background: #111; color: #e0e0e0;',
    '  font-family: "Segoe UI", system-ui, sans-serif; overflow: hidden; -webkit-app-region: drag; }',
    '.wrap { display: flex; flex-direction: column; align-items: center;',
    '  justify-content: space-between; height: 100%; padding: 28px 28px 20px; }',
    '.top { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }',
    '.logo { width: 48px; height: 48px; border-radius: 12px; background: #00c864;',
    '  display: flex; align-items: center; justify-content: center; }',
    '.logo svg { width: 26px; height: 26px; fill: #111; }',
    'h1 { font-size: 20px; font-weight: 600; color: #fff; letter-spacing: -0.3px; }',
    '.tagline { font-size: 12px; color: #777; font-weight: 300; }',
    '.divider { width: 100%; height: 1px; background: rgba(255,255,255,0.07); margin: 4px 0; }',
    '.panels { display: flex; gap: 12px; width: 100%; }',
    '.panel { flex: 1; background: #2b2b2b; border-radius: 10px;',
    '  border: 1px solid rgba(255,255,255,0.06); padding: 12px 14px; }',
    '.panel-title { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;',
    '  color: #888; margin-bottom: 8px; text-align: center; }',
    '.row { display: flex; justify-content: space-between; align-items: center;',
    '  padding: 5px 0; border-top: 1px solid rgba(255,255,255,0.04); gap: 8px; }',
    '.row:first-of-type { border-top: none; padding-top: 0; }',
    '.lbl { font-size: 11px; color: #777; flex-shrink: 0; }',
    '.val { font-size: 11px; color: #ccc; font-weight: 600; text-align: right; display: flex; align-items: center; gap: 4px; justify-content: flex-end; min-width: 0; }',
    '  .val-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }',
    '  .val-time { white-space: nowrap; flex-shrink: 0; }',
    '.key { background: #1e1e1e; border: 1px solid #3a3a3a; border-radius: 6px;',
    '  padding: 2px 8px; font-size: 11px; color: #aaa; font-weight: 500; }',
    '.bottom { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }',
    '.toggle-row { display: flex; align-items: center; justify-content: center;',
    '  gap: 10px; -webkit-app-region: no-drag; }',
    '.toggle-label { font-size: 12px; color: #555; }',
    '.toggle { position: relative; width: 34px; height: 18px; cursor: pointer; }',
    '.toggle input { opacity: 0; width: 0; height: 0; }',
    '.slider { position: absolute; inset: 0; background: #2a2a2a; border-radius: 18px;',
    '  border: 1px solid #333; transition: 0.2s; }',
    '.slider::before { content: ""; position: absolute; width: 12px; height: 12px;',
    '  left: 2px; top: 2px; background: #555; border-radius: 50%; transition: 0.2s; }',
    'input:checked + .slider { background: #00c864; border-color: #00c864; }',
    'input:checked + .slider::before { transform: translateX(16px); background: #111; }',
    '.made-by { font-size: 11px; color: #555; -webkit-app-region: no-drag; }',
    '.made-by a { color: #00c864; text-decoration: none; -webkit-app-region: no-drag; cursor: pointer; }',
    '.made-by a:hover { text-decoration: underline; }',
    '.disclaimer { font-size: 10px; color: #3a3a3a; text-align: center; line-height: 1.5; }',
    '.close-btn { -webkit-app-region: no-drag; background: #00c864; color: #fff;',
    '  border: none; border-radius: 8px; padding: 8px 40px; font-size: 13px;',
    '  font-weight: 600; cursor: pointer; font-family: inherit; transition: opacity 0.15s; }',
    '.close-btn:hover { opacity: 0.85; }',
    '.x-btn { position: fixed; top: 12px; right: 14px; -webkit-app-region: no-drag;',
    '  background: none; border: none; color: #555; font-size: 18px; cursor: pointer;',
    '  line-height: 1; padding: 2px 6px; border-radius: 4px; transition: color 0.15s; }',
    '.x-btn:hover { color: #fff; }',
    '</style></head><body>',
    '<button class="x-btn" id="x-btn">&#x2715;</button>',
    '<div class="wrap">',
    '  <div class="top">',
    '    <div class="logo"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zm0 2a7 7 0 0 1 6.33 4H5.67A7 7 0 0 1 12 5zm-7 7a7 7 0 0 1 .08-1h13.84A7 7 0 0 1 19 12H5zm0 1h14a7 7 0 0 1-6.17 3.64C9.5 16.5 8 15 8 13H6a6 6 0 0 0 .17 1H5a7 7 0 0 1-.02-.44L5 13z"/></svg></div>',
    '    <h1>Radio Garden</h1>',
    '    <p class="tagline">A minimal desktop wrapper for radio.garden</p>',
    '    <div class="divider"></div>',
    '    <div class="panels">',
    '      <div class="panel">',
    '        <div class="panel-title">Shortcuts</div>',
    '        <div class="row"><span class="lbl">Open Favorites</span><span class="key">F</span></div>',
    '        <div class="row"><span class="lbl">Play / Pause</span><span class="key">Space</span></div>',
    '        <div class="row"><span class="lbl">Browse Favorites</span><span class="key">↑ ↓</span></div>',
    '        <div class="row"><span class="lbl">Reload</span><span class="key">Ctrl+R</span></div>',
    '      </div>',
    '      <div class="panel">',
    '        <div class="panel-title">Listening Stats</div>',
    '        <div class="row"><span class="lbl">Today</span><span class="val" id="stat-today">' + (getStatsForAbout().todayFormatted || 'No listening yet') + '</span></div>',
    '        <div class="row"><span class="lbl">Total time</span><span class="val" id="stat-total">' + (getStatsForAbout().totalAllFormatted || 'No listening yet') + '</span></div>',
    '        <div class="row"><span class="lbl">Countries</span><span class="val" id="stat-countries">' + (getStatsForAbout().countriesExplored || 'None yet') + '</span></div>',
    '        <div class="row"><span class="lbl">Top country (7d)</span><span class="val" id="stat-top7">' + (getStatsForAbout().topCountry ? getStatsForAbout().topCountry + ' · ' + getStatsForAbout().topCountryFormatted : '—') + '</span></div>',
    '        <div class="row"><span class="lbl">Top country (all time)</span><span class="val" id="stat-topall">' + (getStatsForAbout().topAllCountry ? getStatsForAbout().topAllCountry + ' · ' + getStatsForAbout().topAllCountryFormatted : '—') + '</span></div>',
    '        <div class="row"><span class="lbl">Favorite station</span><span class="val" id="stat-station">' + (getStatsForAbout().topStation ? '<span class="val-name">' + getStatsForAbout().topStation + '</span><span class="val-time">&nbsp;·&nbsp;' + getStatsForAbout().topStationFormatted + '</span>' : '—') + '</span></div>',
    '        <div class="row"><span class="lbl">Favorite day</span><span class="val" id="stat-favday">' + (getStatsForAbout().favDay || '—') + '</span></div>',
    '        <div class="row"><span class="lbl">Listening style</span><span class="val" id="stat-time">' + (getStatsForAbout().timeLabel || '—') + '</span></div>',
    '      </div>',
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
    '    <div class="made-by">made by <a id="gh-link">unugeorge</a> &nbsp;&middot;&nbsp; v' + app.getVersion() + ' &nbsp;&middot;&nbsp; 2026</div>',
    '    <p class="disclaimer">This is an independent project and is not affiliated with, endorsed by, or associated with Radio Garden.</p>',
    '  </div>',
    '</div>',
    '<script>',
    '  var { ipcRenderer } = require("electron");',
    '  document.getElementById("close-btn").addEventListener("click", function() { window.close(); });',
    '  document.getElementById("x-btn").addEventListener("click", function() { window.close(); });',
    '  document.getElementById("show-toggle").addEventListener("change", function() {',
    '    ipcRenderer.send("about-toggle-launch", this.checked);',
    '  });',
    '  document.getElementById("gh-link").addEventListener("click", function() {',
    '    require("electron").shell.openExternal("https://github.com/chillzaurus/radio-garden-app/");',
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

  aboutWindow.on('closed', function() { aboutWindow = null; aboutWindowReady = false; });
  aboutWindow.webContents.on('did-finish-load', function() { aboutWindowReady = true; });
}

function loadStationHistory() {
  try {
    var p = path.join(app.getPath('userData'), 'station-history.json');
    stationHistory = JSON.parse(fs.readFileSync(p));
  } catch(e) { stationHistory = []; }
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

// ── Discord ───────────────────────────────────────────────────────────────────

function clearDiscord() {
  if (!discordReady || !discordClient) return;
  try { discordClient.clearActivity(); } catch(e) {}
}

function updateDiscord(station, city) {
  if (!discordReady || !discordClient || !discordEnabled) return;
  try {
    discordClient.setActivity({
      details: station || 'Browsing...',
      state: city || 'radio.garden',
      largeImageKey: 'radio_gardener_final',
      largeImageText: 'Radio Garden',
      instance: false,
      type: 2
    });
  } catch(e) {}
}

function initDiscord() {
  try {
    discordClient = new DiscordRPC.Client({ transport: 'ipc' });
    discordClient.on('ready', function() { discordReady = true; });
    discordClient.login({ clientId: '1480025419393536052' }).catch(function() {});
  } catch(e) {}
}

function pollDiscordStation() {
  setInterval(function() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.executeJavaScript(
      '(function() {' +
      '  var channelEl = document.querySelector("[aria-label^=\'Now Playing:\']");' +
      '  if (!channelEl) return { name: null, city: null };' +
      '  var titleContainer = channelEl.querySelector("[class*=_titleContainer]");' +
      '  var nameEl = titleContainer ? titleContainer.querySelector("[class*=_title]") : channelEl.querySelector("[class*=_title]");' +
      '  var cityEl = titleContainer ? titleContainer.querySelector("[class*=_subtitle]") : channelEl.querySelector("[class*=_subtitle]");' +
      '  var isPlaying = !!document.querySelector("[aria-label=\'stop\']");' +
      '  return { name: nameEl ? nameEl.innerText.trim() : null, city: cityEl ? cityEl.innerText.trim() : null, playing: isPlaying };' +
      '})()'
    ).then(function(result) {
      if (result && result.name) {
        updateDiscord(result.name, result.city);
        mainWindow.setTitle(result.name + (result.city ? '  —  ' + result.city : ''));
        tray.setToolTip(result.name + (result.city ? ' — ' + result.city : ''));
        if (!result.city || result.city.toLowerCase().indexOf('loading') === -1) {
          if (result.playing) recordListening(result.city, result.name);
          var entry = result.name + (result.city ? ' — ' + result.city : '');
          if (stationHistory[0] !== entry) {
            stationHistory = [entry].concat(stationHistory.filter(function(s) { return s !== entry; })).slice(0, 5);
            try { fs.writeFileSync(path.join(app.getPath('userData'), 'station-history.json'), JSON.stringify(stationHistory)); } catch(e) { console.error('history save error:', e); }
            updateTrayMenu();
          }
        }
      } else {
        updateDiscord('Browsing...', null);
        mainWindow.setTitle('Radio Garden');
        tray.setToolTip('Radio Garden');
      }
    }).catch(function() {});
  }, 2000);
}

// ── Listening Stats ───────────────────────────────────────────────────────────

var statsPath = null;

function getStatsPath() {
  if (!statsPath) statsPath = path.join(app.getPath('userData'), 'listening-stats.json');
  return statsPath;
}

function loadListeningStats() {
  try {
    listeningStats = JSON.parse(fs.readFileSync(getStatsPath()));
    var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    Object.keys(listeningStats).forEach(function(day) {
      if (new Date(day).getTime() < cutoff) delete listeningStats[day];
    });
  } catch(e) { listeningStats = {}; }
}

function saveListeningStats() {
  try { fs.writeFileSync(getStatsPath(), JSON.stringify(listeningStats)); } catch(e) { console.error('stats save error:', e); }
}

function recordListening(city, stationName) {
  if (!city) return;
  var parts = city.split(',');
  var country = parts[parts.length - 1].trim();
  if (!country) return;
  var d = new Date(); var today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  if (!listeningStats[today]) listeningStats[today] = {};
  if (!listeningStats[today][country]) listeningStats[today][country] = 0;
  listeningStats[today][country] += 2;
  // Track station
  if (stationName) {
    if (!listeningStats[today]['__stations__']) listeningStats[today]['__stations__'] = {};
    if (!listeningStats[today]['__stations__'][stationName]) listeningStats[today]['__stations__'][stationName] = 0;
    listeningStats[today]['__stations__'][stationName] += 2;
  }
  // Track hour
  var hour = new Date().getHours();
  if (!listeningStats[today]['__hours__']) listeningStats[today]['__hours__'] = {};
  var hk = String(hour);
  listeningStats[today]['__hours__'][hk] = (listeningStats[today]['__hours__'][hk] || 0) + 2;
  saveListeningStats();
  if (aboutWindow && !aboutWindow.isDestroyed() && aboutWindowReady) {
    var s = getStatsForAbout();
    aboutWindow.webContents.executeJavaScript(
      '(function() {' +
      '  var t = document.getElementById("stat-today"); if (t) t.textContent = "' + (s.todayFormatted || 'No listening yet') + '";' +
      '  var t7 = document.getElementById("stat-top7"); if (t7) t7.textContent = "' + (s.topCountry ? s.topCountry + ' · ' + s.topCountryFormatted : 'Not enough data') + '";' +
      '  var ta = document.getElementById("stat-topall"); if (ta) ta.textContent = "' + (s.topAllCountry ? s.topAllCountry + ' · ' + s.topAllCountryFormatted : 'Not enough data') + '";' +
      '  var tt = document.getElementById("stat-total"); if (tt) tt.textContent = "' + (s.totalAllFormatted || 'No listening yet') + '";' +
      '  var tc = document.getElementById("stat-countries"); if (tc) tc.textContent = "' + (s.countriesExplored ? s.countriesExplored + (s.countriesExplored === 1 ? ' country' : ' countries') : 'None yet') + '";' +
      '  var fd = document.getElementById("stat-favday"); if (fd) fd.textContent = "' + (s.favDay || 'Not enough data') + '";' +
      '  var ss = document.getElementById("stat-station"); if (ss) ss.innerHTML = "' + (s.topStation ? '<span class=\\\'val-name\\\'>' + s.topStation + '</span><span class=\\\'val-time\\\'>&nbsp;&middot;&nbsp;' + s.topStationFormatted + '</span>' : '\u2014') + '";' +
      '  var sc = document.getElementById("stat-countries"); if (sc) sc.textContent = "' + (s.countriesExplored || 'None yet') + '";' +
      '  var stm = document.getElementById("stat-time"); if (stm) stm.textContent = "' + (s.timeLabel || '—') + '";' +
      '})()'
    ).catch(function() {});
  }
}

function getStatsForAbout() {
  var d = new Date(); var today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  var todayTotal = 0;
  if (listeningStats[today]) {
    Object.keys(listeningStats[today]).forEach(function(k) {
      if (k !== '__stations__' && k !== '__hours__') todayTotal += listeningStats[today][k];
    });
  }
  var countryTotals = {};
  Object.values(listeningStats).forEach(function(day) {
    Object.keys(day).forEach(function(country) {
      if (country === '__stations__' || country === '__hours__') return;
      countryTotals[country] = (countryTotals[country] || 0) + day[country];
    });
  });
  var topCountry = null, topSeconds = 0;
  Object.keys(countryTotals).forEach(function(c) {
    if (countryTotals[c] > topSeconds) { topSeconds = countryTotals[c]; topCountry = c; }
  });
  var fmt = function(s) {
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm';
    return '< 1m';
  };
  // All-time top country (from full file, not just 7d)
  var allCountryTotals = {};
  try {
    var allData = JSON.parse(fs.readFileSync(getStatsPath()));
    Object.values(allData).forEach(function(day) {
      Object.keys(day).forEach(function(country) {
        if (country === '__stations__' || country === '__hours__') return;
        allCountryTotals[country] = (allCountryTotals[country] || 0) + day[country];
      });
    });
  } catch(e) { allCountryTotals = countryTotals; }
  var topAllCountry = null, topAllSeconds = 0;
  Object.keys(allCountryTotals).forEach(function(c) {
    if (allCountryTotals[c] > topAllSeconds) { topAllSeconds = allCountryTotals[c]; topAllCountry = c; }
  });
  // Shorten country names
  var shortCountry = function(c) {
    if (!c) return c;
    return c.replace('United Kingdom', 'UK').replace('United States', 'US').replace('United Arab Emirates', 'UAE');
  };

  // Time of day preference
  var hourTotals = {};
  try {
    var allData4 = JSON.parse(fs.readFileSync(getStatsPath()));
    Object.values(allData4).forEach(function(day) {
      if (day['__hours__']) {
        Object.keys(day['__hours__']).forEach(function(h) {
          hourTotals[h] = (hourTotals[h] || 0) + day['__hours__'][h];
        });
      }
    });
  } catch(e) {}
  var timeLabel = null;
  if (Object.keys(hourTotals).length > 0) {
    var slots = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    Object.keys(hourTotals).forEach(function(h) {
      var hr = parseInt(h);
      if (hr >= 6 && hr < 12) slots.morning += hourTotals[h];
      else if (hr >= 12 && hr < 18) slots.afternoon += hourTotals[h];
      else if (hr >= 18 && hr < 22) slots.evening += hourTotals[h];
      else slots.night += hourTotals[h];
    });
    var best = Object.keys(slots).reduce(function(a, b) { return slots[a] >= slots[b] ? a : b; });
    var labels = { morning: 'Early Bird', afternoon: 'Daytime Drifter', evening: 'Evening Explorer', night: 'Night Owl' };
    timeLabel = labels[best];
  }

  // Most listened station (all time)
  var allStationTotals = {};
  try {
    var allData3 = JSON.parse(fs.readFileSync(getStatsPath()));
    Object.values(allData3).forEach(function(day) {
      if (day['__stations__']) {
        Object.keys(day['__stations__']).forEach(function(st) {
          allStationTotals[st] = (allStationTotals[st] || 0) + day['__stations__'][st];
        });
      }
    });
  } catch(e) {}
  var topStation = null, topStationSeconds = 0;
  Object.keys(allStationTotals).forEach(function(st) {
    if (allStationTotals[st] > topStationSeconds) { topStationSeconds = allStationTotals[st]; topStation = st; }
  });

  // Total all-time listening
  var totalAllSeconds = 0;
  Object.keys(allCountryTotals).forEach(function(c) { totalAllSeconds += allCountryTotals[c]; });

  // Countries explored (all time)
  var countriesExplored = Object.keys(allCountryTotals).length;

  // Favorite day of week (all time)
  var dayTotals = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
  var dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  try {
    var allData2 = JSON.parse(fs.readFileSync(getStatsPath()));
    Object.keys(allData2).forEach(function(dateStr) {
      var dow = new Date(dateStr).getDay();
      Object.keys(allData2[dateStr]).forEach(function(k) {
        if (k === '__stations__' || k === '__hours__') return;
        dayTotals[dow] += allData2[dateStr][k];
      });
    });
  } catch(e) {}
  var favDay = null, favDaySeconds = 0;
  Object.keys(dayTotals).forEach(function(d) {
    if (dayTotals[d] > favDaySeconds) { favDaySeconds = dayTotals[d]; favDay = dayNames[d]; }
  });

  return {
    todayFormatted: todayTotal > 0 ? fmt(todayTotal) : null,
    topCountry: shortCountry(topCountry),
    topCountryFormatted: topSeconds > 0 ? fmt(topSeconds) : null,
    topAllCountry: shortCountry(topAllCountry),
    topAllCountryFormatted: topAllSeconds > 0 ? fmt(topAllSeconds) : null,
    totalAllFormatted: totalAllSeconds > 0 ? fmt(totalAllSeconds) : null,
    countriesExplored: countriesExplored > 0 ? (countriesExplored >= 195 ? 'Mr. Worldwide!' : countriesExplored + (countriesExplored === 1 ? ' country' : ' countries')) : null,
    favDay: favDaySeconds > 0 ? favDay : null,
    topStation: topStation,
    topStationFormatted: topStationSeconds > 0 ? fmt(topStationSeconds) : null,
    timeLabel: timeLabel
  };
}


// ── Favorites Folders ─────────────────────────────────────────────────────────
var foldersPath = null;
function getFoldersPath() {
  if (!foldersPath) foldersPath = path.join(app.getPath('userData'), 'favorites-folders.json');
  return foldersPath;
}
function loadFolders() {
  try { return JSON.parse(fs.readFileSync(getFoldersPath())); } catch(e) { return { folders: [], assignments: {} }; }
}
function saveFolders(data) {
  try { fs.writeFileSync(getFoldersPath(), JSON.stringify(data)); } catch(e) {}
}
ipcMain.handle('folders-load', function() { return loadFolders(); });
ipcMain.handle('folders-save', function(e, data) { saveFolders(data); return true; });

// ── Tray Menu ─────────────────────────────────────────────────────────────────

function updateTrayMenu() {
  var sleepItems = [5, 15, 30, 60, 90].map(function(min) {
    return { label: min + ' minutes', click: function() { setSleepTimer(min); } };
  });
  sleepItems.push({ label: 'Other…', click: function() { promptCustomSleepTimer(); } });

  var trayMenu = Menu.buildFromTemplate([
    {
      label: 'Open Radio Garden',
      click: function() { fadeIn(); }
    },
    {
      label: 'Recent Stations',
      enabled: stationHistory.length > 0,
      submenu: stationHistory.length > 0
        ? stationHistory.map(function(entry) { return { label: entry, enabled: false }; })
        : [{ label: 'No history yet', enabled: false }]
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
        },
        {
          label: 'Show in Discord',
          type: 'checkbox',
          checked: discordEnabled,
          click: function() {
            discordEnabled = !discordEnabled;
            if (!discordEnabled) clearDiscord();
            updateTrayMenu();
          }
        },
        {
          label: 'Launch at Startup',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: function() {
            var current = app.getLoginItemSettings().openAtLogin;
            app.setLoginItemSettings({ openAtLogin: !current });
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

  const iconPath = process.platform === 'linux' 
    ? path.join(__dirname, 'icon.png') 
    : path.join(__dirname, 'icon.ico');

  mainWindow = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    frame: true,
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    backgroundColor: '#121212',
    icon: iconPath,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
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
    try {
      var injectCode = fs.readFileSync(path.join(__dirname, 'folders-inject.js'), 'utf8');
      mainWindow.webContents.executeJavaScript(injectCode).catch(function(e) { console.error('folders inject error:', e); });
    } catch(e) { console.error('folders inject read error:', e); }
  });

  mainWindow.webContents.on('before-input-event', function(event, input) {
    if (input.type === 'keyDown' && input.key === 'r' && input.control && !input.alt && !input.meta) {
      event.preventDefault();
      mainWindow.webContents.reload();
      return;
    }
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
    if (!app.isQuiting) {
      event.preventDefault();
      fadeOutAndHide();
    }
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

  const trayIconPath = process.platform === 'linux' 
    ? path.join(__dirname, 'icon.png') 
    : path.join(__dirname, 'icon.ico');

  tray = new Tray(trayIconPath);
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
  loadStationHistory();
  loadListeningStats();
  checkFirstLaunch();
  initDiscord();
  pollDiscordStation();

  try {
    var updater = require('electron-updater').autoUpdater;
    updater.autoInstallOnAppQuit = true;
    updater.setFeedURL({
      provider: 'github',
      owner: 'chillzaurus',
      repo: 'radio-garden-app'
    });
    updater.checkForUpdatesAndNotify();
    updater.on('update-available', function(info) {
      var { dialog } = require('electron');
      dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: 'v' + info.version + ' is downloading in the background. You\'ll be prompted to install when it\'s ready.',
        buttons: ['OK']
      });
    });
    updater.on('update-downloaded', function(info) {
      var { dialog } = require('electron');
      dialog.showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: 'v' + info.version + ' has been downloaded. Restart now to install?',
        buttons: ['Restart now', 'Later'],
        defaultId: 0
      }).then(function(result) {
        if (result.response === 0) {
          app.isQuiting = true;
          updater.quitAndInstall();
        }
      });
    });
  } catch(e) {}

  ipcMain.on('about-toggle-launch', function(event, value) {
    var firstLaunchPath = path.join(app.getPath('userData'), 'show-about-on-launch.json');
    fs.writeFileSync(firstLaunchPath, JSON.stringify({ show: value }));
  });
});