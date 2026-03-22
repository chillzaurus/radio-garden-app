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

app.setName('Radio Garden');
app.setAppUserModelId('Radio Garden');
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
    // Fade out volume over 30 seconds then quit
    if (mainWindow && !mainWindow.isDestroyed()) {
      var fadeSteps = 60;
      var fadeInterval = 500; // 30s total
      var step = 0;
      mainWindow.webContents.executeJavaScript('(function(){ var v = document.querySelector("[aria-label=\'Set Volume\']"); return v ? parseFloat(v.value) : 1; })()').then(function(vol) {
        var startVol = isNaN(vol) || vol < 0 ? 1 : vol;
        var fadeTick = setInterval(function() {
          step++;
          var newVol = startVol * (1 - step / fadeSteps);
          if (newVol < 0) newVol = 0;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.executeJavaScript('(function(){ var v = document.querySelector("[aria-label=\'Set Volume\']"); if(v){ var nv = ' + newVol + '; var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(v,nv); v.dispatchEvent(new Event("input",{bubbles:true})); } })()').catch(function(){});
          }
          if (step >= fadeSteps) {
            clearInterval(fadeTick);
            app.isQuiting = true;
            app.quit();
          }
        }, fadeInterval);
      }).catch(function() { app.isQuiting = true; app.quit(); });
    } else {
      app.isQuiting = true;
      app.quit();
    }
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
    '.logo { width: 48px; height: 48px; border-radius: 12px; overflow: hidden;',
    '  display: flex; align-items: center; justify-content: center; }',
    '.logo img { width: 48px; height: 48px; }',
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
    '.val { font-size: 11px; color: #ccc; font-weight: 600; text-align: right; display: flex; align-items: center; gap: 4px; justify-content: flex-end; min-width: 0; position: relative; }',
    '  .val-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; cursor: default; }',
    '  #stat-station { -webkit-app-region: no-drag; }',
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
    '    <div class="logo"><img src="data:image/png;base64,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" /></div>',
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
    '        <div class="row"><span class="lbl">Favorite station</span><span class="val" id="stat-station">' + (getStatsForAbout().topStation ? '<span class="val-name" title="' + getStatsForAbout().topStation + '">' + getStatsForAbout().topStation + '</span><span class="val-time">&nbsp;·&nbsp;' + getStatsForAbout().topStationFormatted + '</span>' : '—') + '</span></div>',
    '        <div class="row"><span class="lbl">Favorite day</span><span class="val" id="stat-favday">' + (getStatsForAbout().favDay || '—') + '</span></div>',
    '        <div class="row"><span class="lbl">Listening style</span><span class="val" id="stat-time">' + (getStatsForAbout().timeLabel || '—') + '</span></div>',
    '        <div class="row"><span class="lbl">Streak</span><span class="val" id="stat-streak">' + (getStatsForAbout().streak > 0 ? '🔥 ' + getStatsForAbout().streak + ' day' + (getStatsForAbout().streak === 1 ? '' : 's') : '—') + '</span></div>',
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

  // Write HTML to temp file and load it (more reliable than document.write for large HTML)
  var tmpPath = path.join(app.getPath('temp'), 'rg-about.html');
  fs.writeFileSync(tmpPath, html);
  aboutWindow.loadFile(tmpPath);

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
      '  var ss = document.getElementById("stat-station"); if (ss) ss.innerHTML = "' + (s.topStation ? '<span class=\\\'val-name\\\' title=\\\''+s.topStation+'\\\'>'+s.topStation+'</span><span class=\\\'val-time\\\'>&nbsp;&middot;&nbsp;'+s.topStationFormatted+'</span>' : '\u2014') + '";' +
      '  var sc = document.getElementById("stat-countries"); if (sc) sc.textContent = "' + (s.countriesExplored || 'None yet') + '";' +
      '  var stm = document.getElementById("stat-time"); if (stm) stm.textContent = "' + (s.timeLabel || '—') + '";' +
      '  var stk = document.getElementById("stat-streak"); if (stk) stk.textContent = "' + (s.streak > 0 ? '🔥 ' + s.streak + ' day' + (s.streak === 1 ? '' : 's') : '—') + '";' +
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
  Object.keys(dayTotals).forEach(function(dow2) {
    if (dayTotals[dow2] > favDaySeconds) { favDaySeconds = dayTotals[dow2]; favDay = dayNames[dow2]; }
  });

  // Calculate listening streak
  var streak = 0;
  try {
    var allDataStreak = JSON.parse(fs.readFileSync(getStatsPath()));
    var checkDate = new Date();
    // If no listening today yet, start checking from yesterday
    var todayKey = checkDate.getFullYear() + '-' + String(checkDate.getMonth()+1).padStart(2,'0') + '-' + String(checkDate.getDate()).padStart(2,'0');
    var hasToday = allDataStreak[todayKey] && Object.keys(allDataStreak[todayKey]).some(function(k) { return k !== '__stations__' && k !== '__hours__' && allDataStreak[todayKey][k] > 0; });
    if (!hasToday) checkDate.setDate(checkDate.getDate() - 1);
    while (true) {
      var dk = checkDate.getFullYear() + '-' + String(checkDate.getMonth()+1).padStart(2,'0') + '-' + String(checkDate.getDate()).padStart(2,'0');
      var dayData = allDataStreak[dk];
      var hasListening = dayData && Object.keys(dayData).some(function(k) { return k !== '__stations__' && k !== '__hours__' && dayData[k] > 0; });
      if (!hasListening) break;
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
  } catch(e) {}

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
    timeLabel: timeLabel,
    streak: streak
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

  var trayHintPath = path.join(app.getPath('userData'), 'tray-hint-shown.json');
  var hasShownTrayHint = false;
  try { hasShownTrayHint = JSON.parse(fs.readFileSync(trayHintPath)).shown; } catch(e) {}
  mainWindow.on('close', function(event) {
    if (!app.isQuiting) {
      event.preventDefault();
      fadeOutAndHide();
      if (!hasShownTrayHint) {
        hasShownTrayHint = true;
        fs.writeFileSync(trayHintPath, JSON.stringify({ shown: true }));
        tray.displayBalloon({
          title: ' ',
          title: ' ',
          content: 'Still running in the tray. Click the icon to reopen.',
          icon: path.join(__dirname, 'icon.ico'),
          noSound: false
        });
      }
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
    // update-available: silent download, no popup
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