(function() {
  if (window.__foldersInjected) return;
  window.__foldersInjected = true;

  var ipc = window.__rgFolders;
  var state = { folders: [], assignments: {}, collapsed: {}, order: [], sortMode: 'manual', folderColors: {}, compact: false };
  var activeKey = null;
  var dragKey = null;
  var pauseObserver = false;
  var needsPin = false; // set true when station changes, cleared after scroll
  var lastScrolledKey = null; // track last key we scrolled to

  async function loadState() {
    var data = await ipc.load();
    state.folders = data.folders || [];
    state.assignments = data.assignments || {};
    state.collapsed = data.collapsed || {};
    state.order = data.order || [];
    state.sortMode = data.sortMode || 'manual';
    state.compact = data.compact || false;
    state.folderColors = data.folderColors || {};
  }
  function saveState() {
    ipc.save({
      folders: state.folders,
      assignments: state.assignments,
      collapsed: state.collapsed,
      order: state.order,
      sortMode: state.sortMode,
      compact: state.compact,
      folderColors: state.folderColors
    });
  }

  function getStations() {
    var rows = Array.from(document.querySelectorAll('[class*=_link_][role="button"]')).reverse();
    return rows.map(function(el) {
      var nameEl = el.querySelector('[class*=_title_][dir="auto"]');
      var cityEl = el.querySelector('[class*=_subtitle_][dir="auto"]');
      var name = nameEl ? nameEl.innerText.trim() : '';
      var city = cityEl ? cityEl.innerText.trim() : '';
      return { el: el, name: name, city: city, key: name + '|' + city };
    }).filter(function(s) { return s.name; });
  }

  var style = document.createElement('style');
  style.textContent = [
    '.__fov { position:absolute; inset:0; background:#2b2b2b; z-index:9999; display:flex; flex-direction:column; font-family:"Segoe UI",system-ui,sans-serif; overflow:hidden; top:0; }',
    '.__fov-addfolder { white-space:nowrap; cursor:pointer; font-family:inherit; font-size:12px; font-weight:500; color:#fff; transition:color 0.15s; background:transparent; border:none; padding:0; }',
    '.__fov-addfolder:hover { color:#00c864; }',
    '.__fov-top { display:flex; flex-direction:column; flex-shrink:0; }',
    '.__fov-search-wrap { position:relative; flex-shrink:0; background:#222; border-bottom:1px solid #2f2f2f; z-index:2; }',
    '.__fov-search { background:transparent; border:none; color:#ddd; font-size:13px; font-family:inherit; padding:7px 32px 7px 12px; outline:none; width:100%; box-sizing:border-box; }',
    '.__fov-search::placeholder { color:#444; }',
    '.__fov-search-clear { position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:none; color:#555; font-size:14px; cursor:pointer; padding:2px 4px; line-height:1; display:none; }',
    '.__fov-search-clear:hover { color:#aaa; }',
    '.__fov-empty { color:#444; font-size:12px; text-align:center; padding:14px 0 10px; pointer-events:none; }',
    '.__fov-scroll { flex:1; overflow-y:overlay; overflow-x:hidden; padding:8px 0 12px; min-height:0; }',
    '.__fov-scroll { scrollbar-width:thin; scrollbar-color:#4a4a4a #1e1e1e; }',
    '.__fov-scroll::-webkit-scrollbar { width:4px; }',
    '.__fov-scroll::-webkit-scrollbar-track { background:#1e1e1e; }',
    '.__fov-scroll::-webkit-scrollbar-thumb { background:#4a4a4a; border-radius:2px; min-height:20px; }',
    '.__fov-scroll::-webkit-scrollbar-thumb:hover { background:#666; }',
    '.__fov-folder { margin:0 8px 4px; border-radius:8px; overflow:hidden; border:1px solid rgba(255,255,255,0.07); transition:border-color 0.2s; }',
    '.__fov-folder.folder-playing-collapsed { border-left:3px solid #00c864 !important; }',
    '.__fov-color-dot { width:9px; height:9px; border-radius:50%; flex-shrink:0; cursor:pointer; border:1.5px solid rgba(255,255,255,0.15); transition:transform 0.15s,border-color 0.15s; }',
    '.__fov-color-dot:hover { transform:scale(1.3); border-color:rgba(255,255,255,0.4); }',
    '.__fov-color-picker { position:fixed; background:#1a1a1a; border:1px solid #333; border-radius:8px; padding:8px; display:grid; grid-template-columns:repeat(4,16px); gap:6px; z-index:10001; box-shadow:0 4px 16px rgba(0,0,0,0.5); }',
    '.__fov-color-swatch { width:16px; height:16px; border-radius:50%; cursor:pointer; border:1.5px solid rgba(255,255,255,0.1); transition:transform 0.12s,border-color 0.12s; }',
    '.__fov-color-swatch:hover { transform:scale(1.25); border-color:rgba(255,255,255,0.5); }',
    '.__fov-color-swatch.selected { border-color:#fff; transform:scale(1.15); }',
    '.__fov-folder-drop-line { position:absolute; left:8px; right:8px; height:2px; background:#00c864; border-radius:1px; pointer-events:none; z-index:100; }',
    '.__fov-folder.folder-dragging { opacity:0.4; }',
    '.__fov-folder-header { display:flex; align-items:center; padding:9px 12px; background:#1e1e1e; cursor:pointer; user-select:none; gap:8px; }',
    '.__fov-folder-header:hover { background:#232323; }',
    '.__fov-folder-arrow { font-size:9px; color:#555; transition:transform 0.15s; flex-shrink:0; display:inline-block; }',
    '.__fov-folder-arrow.open { transform:rotate(90deg); }',
    '.__fov-folder-name-input { font-size:13px; color:#fff; background:none; border:none; outline:none; flex:1; font-family:inherit; cursor:text; font-weight:500; }',
    '.__fov-folder-count { font-size:11px; color:#888; flex-shrink:0; }',
    '.__fov-folder-del { background:none; border:none; color:#666; font-size:16px; cursor:pointer; padding:0 2px; line-height:1; flex-shrink:0; }',
    '.__fov-folder-del:hover { color:#e05555; }',
    '.__fov-folder-stations { background:#232323; }',
    '.__fov-station { display:flex; align-items:center; padding:10px 12px 10px 28px; cursor:pointer; gap:8px; border-top:1px solid rgba(255,255,255,0.05); }',
    '.__fov.compact .__fov-station { padding-top:5px; padding-bottom:5px; }',
    '.__fov.compact .__fov-station-city { display:none; }',
    '.__fov.compact .__fov-station-name { font-size:13px; }',
    '.__fov.compact .__fov-folder-header { padding:6px 10px; }',
    '.__fov.compact .__fov-folder-name-input { font-size:12px; }',
    '.__fov.compact .__fov-folder { margin-bottom:2px; }',

    '.__fov-station:hover { background:#2a2a2a; }',
    '.__fov-station-info { flex:1; min-width:0; }',
    '.__fov-station-name { font-size:16px; color:#e0e0e0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.__fov-station-city { font-size:12px; color:#aaa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }',
    '.__fov-station-btns { display:flex; align-items:center; gap:2px; opacity:0; flex-shrink:0; }',
    '.__fov-station:hover .__fov-station-btns { opacity:1; }',
    '.__fov-station-move { background:none; border:none; color:#555; font-size:13px; cursor:pointer; padding:0 3px; line-height:1; }',
    '.__fov-station-move:hover { color:#00c864; }',
    '.__fov-unassigned { margin:4px 8px 0; }',
    '.__fov-unassigned-label { font-size:10px; letter-spacing:0.08em; text-transform:uppercase; color:#555; padding:10px 10px 4px; display:flex; align-items:center; justify-content:space-between; }',
    '.__fov-sort-btn { background:none; border:1px solid #3a3a3a; border-radius:4px; color:#555; font-size:9px; padding:2px 6px; cursor:pointer; font-family:inherit; letter-spacing:0.05em; text-transform:uppercase; transition:color 0.15s,border-color 0.15s; }',
    '.__fov-sort-btn:hover { color:#00c864; border-color:#00c864; }',
    '.__fov-sort-btn.active { color:#00c864; border-color:#00c864; }',
    '.__fov-station.unassigned { padding-left:12px; }',
    '.__fov-station.unassigned:hover { background:#303030; }',
    '.__fov-picker { position:fixed; background:#1e1e1e; border:1px solid #3a3a3a; border-radius:10px; padding:6px; z-index:10001; min-width:160px; box-shadow:0 6px 24px rgba(0,0,0,0.8); }',
    '.__fov-picker-item { padding:8px 12px; font-size:13px; color:#ccc; cursor:pointer; border-radius:6px; }',
    '.__fov-picker-item:hover { background:#2a2a2a; color:#fff; }',
    '.__fov-picker-remove { color:#e05555; }',
    '.__fov-picker-new { color:#00c864; }',
    '.__fov-station.dragging { opacity:0.4; }',
    '.__fov-folder.drag-over .__fov-folder-header { border:1px solid #00c864; background:#1a2e22; }',
    '.__fov-station.unassigned.drag-over { background:#1a2e22; outline:1px solid #00c864; border-radius:4px; }',
    '.__fov-station.drop-above { border-top:2px solid #00c864 !important; }',
    '.__fov-station.drop-below { border-bottom:2px solid #00c864 !important; }',
    '.__fov-station.active { border-left:3px solid #00c864 !important; }'
  ].join('\n');
  document.head.appendChild(style);


  var picker = null;
  function closePicker() { if (picker) { picker.remove(); picker = null; } }

  function showPicker(stationKey, anchorEl) {
    closePicker();
    var currentFolder = state.assignments[stationKey];
    picker = document.createElement('div');
    picker.className = '__fov-picker';
    var rect = anchorEl.getBoundingClientRect();
    picker.style.top = (rect.top - 4) + 'px';
    picker.style.left = (rect.right + 6) + 'px';

    if (currentFolder) {
      var rem = document.createElement('div');
      rem.className = '__fov-picker-item __fov-picker-remove';
      rem.textContent = '\u2715  Remove from folder';
      rem.onclick = function() { delete state.assignments[stationKey]; saveState(); render(); closePicker(); };
      picker.appendChild(rem);
    }

    state.folders.forEach(function(f) {
      if (f.id === currentFolder) return; // skip current folder
      var item = document.createElement('div');
      item.className = '__fov-picker-item';
      item.textContent = '\ud83d\udcc1  ' + f.name;
      item.onclick = function() { state.assignments[stationKey] = f.id; saveState(); render(); closePicker(); };
      picker.appendChild(item);
    });

    var newItem = document.createElement('div');
    newItem.className = '__fov-picker-item __fov-picker-new';
    newItem.textContent = '+ New folder';
    newItem.onclick = function() { closePicker(); createFolder(stationKey); };
    picker.appendChild(newItem);

    var sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.07);margin:4px 0;';
    picker.appendChild(sep);

    var removeItem = document.createElement('div');
    removeItem.className = '__fov-picker-item __fov-picker-remove';
    removeItem.textContent = '♥ Remove from Favorites';
    removeItem.onclick = function() {
      closePicker();
      var stationName = stationKey.split('|')[0];

      // Optimistically update our UI
      delete state.assignments[stationKey];
      saveState();
      render();
      pauseObserver = true;

      function fireReactClick(el) {
        var fk = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber'); });
        if (!fk) { el.click(); return; }
        var f = el[fk];
        while (f) {
          if (f.memoizedProps && f.memoizedProps.onClick) {
            f.memoizedProps.onClick({ type:'click', preventDefault:function(){}, stopPropagation:function(){} });
            return;
          }
          f = f.return;
        }
        el.click();
      }

      function tryRemoveFromPlayer() {
        // Player bar heart: aria-label="remove X from favorites"
        var heart = Array.from(document.querySelectorAll('[aria-label]')).find(function(el) {
          var lbl = el.getAttribute('aria-label') || '';
          return lbl === 'remove ' + stationName + ' from favorites';
        });
        if (!heart) return false;
        fireReactClick(heart);
        setTimeout(function() { pauseObserver = false; render(); }, 500);
        return true;
      }

      function tryRemoveFromEditMode() {
        // Edit mode hearts: aria-label="remove from favorites", find by matching row title
        var hearts = Array.from(document.querySelectorAll('[data-accessory="favorite"]'));
        var heart = hearts.find(function(h) {
          // Walk up to find the row div, then look for title text
          var el = h.parentElement;
          while (el && !el.querySelector('[dir="auto"]')) el = el.parentElement;
          if (!el) return false;
          var title = el.querySelector('[dir="auto"]');
          return title && title.innerText.trim() === stationName;
        });
        if (!heart) return false;
        fireReactClick(heart);
        // Exit edit mode
        setTimeout(function() {
          var doneBtn = document.querySelector('[data-id="edit-button"][aria-label="Done"]');
          if (doneBtn) { doneBtn.style.display=''; fireReactClick(doneBtn); doneBtn.style.display='none'; }
          setTimeout(function() { pauseObserver = false; render(); }, 300);
        }, 300);
        return true;
      }

      // Try player heart first (station already playing)
      if (tryRemoveFromPlayer()) return;

      // Enter edit mode
      var editBtn = document.querySelector('[data-id="edit-button"]');
      if (!editBtn) { pauseObserver = false; return; }
      editBtn.style.display = '';
      fireReactClick(editBtn);
      editBtn.style.display = 'none';

      // Poll for edit mode hearts
      var attempts = 0;
      var poll = setInterval(function() {
        attempts++;
        if (tryRemoveFromEditMode()) { clearInterval(poll); }
        else if (attempts > 20) { clearInterval(poll); pauseObserver = false; }
      }, 150);
    };
    picker.appendChild(removeItem);

    document.body.appendChild(picker);
    setTimeout(function() {
      document.addEventListener('click', closePicker, { once: true });
    }, 0);
  }

  function createFolder(assignKey) {
    var id = 'f' + Date.now();
    state.folders.push({ id: id, name: 'New Folder' });
    if (assignKey) state.assignments[assignKey] = id;
    saveState();
    render();
    setTimeout(function() {
      var inp = document.querySelector('.__fov-folder-name-input[data-id="' + id + '"]');
      if (inp) { inp.readOnly = false; inp.style.pointerEvents = 'auto'; inp.focus(); inp.select(); }
    }, 50);
  }

  function syncActiveHighlight(andScroll) {
    var nowPlaying = document.querySelector('[aria-label^="Now Playing:"]');
    var nameEl = nowPlaying ? nowPlaying.querySelector('[class*=_title][dir="auto"], [class*=_title_]') : null;
    if (!nameEl) return;
    var playingName = nameEl.innerText.trim();
    if (!playingName) {
      // Buffering - keep last known highlight, still scroll if requested
      if (andScroll && activeKey) {
        var ar = Array.from(document.querySelectorAll('.__fov-station'))
          .find(function(r) { return r.dataset.stationKey === activeKey; });
        if (ar) ar.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }
    // Match by name only (city format differs between list and player)
    var rows = Array.from(document.querySelectorAll('.__fov-station'));
    var matchedRow = rows.find(function(r) {
      return r.dataset.stationKey && r.dataset.stationKey.split('|')[0] === playingName;
    });
    var newKey = matchedRow ? matchedRow.dataset.stationKey : null;
    if (newKey && newKey !== activeKey) { activeKey = newKey; needsPin = true; }
    else if (newKey) activeKey = newKey;
    // Always reapply highlights (survives render() wiping innerHTML)
    rows.forEach(function(row) {
      var isActive = activeKey && row.dataset.stationKey === activeKey;
      row.style.borderLeft = isActive ? '3px solid #00c864' : '';
      row.style.paddingLeft = isActive ? (row.classList.contains('unassigned') ? '9px' : '25px') : '';
    });
    // Folder playing indicator - only on collapsed folders
    document.querySelectorAll('.__fov-folder').forEach(function(folderEl) {
      folderEl.classList.remove('folder-playing-collapsed');
    });
    if (activeKey) {
      var activeFolderId = state.assignments[activeKey];
      if (activeFolderId) {
        var folderEl = document.querySelector('[data-folder-id="' + activeFolderId + '"]');
        // collapsed means state.collapsed[id] is NOT true (default is closed but we track open as true)
        var isOpen = state.collapsed[activeFolderId] === true;
        if (folderEl && !isOpen) {
          folderEl.classList.add('folder-playing-collapsed');
        }
      }
    }
    // Only scroll if station changed since last pin (needsPin) and caller wants scroll
    if (andScroll && activeKey && needsPin) {
      var scrollTarget = matchedRow || Array.from(document.querySelectorAll('.__fov-station'))
        .find(function(r) { return r.dataset.stationKey === activeKey; });
      if (scrollTarget) {
        var scrollEl = document.querySelector('.__fov-scroll');
        if (scrollEl) {
          var targetTop = scrollTarget.offsetTop;
          var targetH = scrollTarget.offsetHeight;
          var scrollH = scrollEl.offsetHeight;
          scrollEl.scrollTo({ top: targetTop - scrollH / 2 + targetH / 2, behavior: 'smooth' });
          needsPin = false;
          lastScrolledKey = activeKey;
        }
      }
    }
  }


  var FOV_PALETTE = [
    null,
    '#e07b7b',  // red
    '#e0a86b',  // orange
    '#e0d46b',  // yellow
    '#8dd46b',  // green
    '#6bd4b0',  // teal
    '#6baee0',  // blue
    '#8b6be0',  // indigo
    '#c46be0',  // purple
    '#e06bb8',  // pink
    '#e0a0a0',  // blush
    '#a0c8e0',  // powder blue
    '#a0e0b8',  // mint
    '#e07840',  // warm orange
    '#6be0d4',  // cyan
    '#c8a0e0',  // lilac
  ];

  var colorPickerEl = null;
  function closeColorPicker() {
    if (colorPickerEl) { colorPickerEl.remove(); colorPickerEl = null; }
  }

  function showColorPicker(folderId, dotEl) {
    closeColorPicker();
    var cp = document.createElement('div');
    cp.className = '__fov-color-picker';
    colorPickerEl = cp;

    FOV_PALETTE.forEach(function(hex) {
      var swatch = document.createElement('div');
      swatch.className = '__fov-color-swatch' + ((state.folderColors[folderId] || null) === hex ? ' selected' : '');
      swatch.style.background = hex || '#2e2e2e';
      if (!hex) {
        swatch.title = 'No color';
        swatch.style.display = 'flex';
        swatch.style.alignItems = 'center';
        swatch.style.justifyContent = 'center';
        swatch.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="#777" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="#777" stroke-width="1.5" stroke-linecap="round"/></svg>';
      }
      swatch.onmousedown = function(e) { e.preventDefault(); e.stopPropagation(); };
      swatch.onclick = function(e) {
        e.stopPropagation();
        if (hex) state.folderColors[folderId] = hex;
        else delete state.folderColors[folderId];
        saveState();
        closeColorPicker();
        render();
      };
      cp.appendChild(swatch);
    });

    document.body.appendChild(cp);
    var rect = dotEl.getBoundingClientRect();
    var left = rect.left;
    var top = rect.bottom + 6;
    if (left + 128 > window.innerWidth) left = window.innerWidth - 136;
    cp.style.left = left + 'px';
    cp.style.top = top + 'px';

    setTimeout(function() {
      document.addEventListener('click', closeColorPicker, { once: true });
    }, 0);
  }


  function updateTitleBadge() {
    var titleEl = document.querySelector('[id="bht"]');
    if (!titleEl) return;
    var count = getStations().length;
    // Remove existing badge if any
    var existing = titleEl.querySelector('.__fov-title-badge');
    if (existing) existing.remove();
    if (count > 0) {
      var badge = document.createElement('span');
      badge.className = '__fov-title-badge';
      badge.textContent = ' (' + count + ')';
      badge.style.cssText = 'font-size:0.75em; opacity:0.5; font-weight:400;';
      titleEl.appendChild(badge);
    }
  }

  function render() {
    var ov = document.querySelector('.__fov');
    if (!ov) return;
    ov.classList.toggle('compact', !!state.compact);
    var searchInput = ov.querySelector('.__fov-search'); // inside .__fov-search-wrap
    var filterText = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var allStations = getStations();
    var stations = filterText ? allStations.filter(function(s) {
      return s.name.toLowerCase().includes(filterText) || (s.city||'').toLowerCase().includes(filterText);
    }) : allStations;
    var grouped = {};
    state.folders.forEach(function(f) { grouped[f.id] = []; });
    var unassigned = [];
    // Apply custom order if set
    if (state.order && state.order.length) {
      stations.sort(function(a, b) {
        var ai = state.order.indexOf(a.key);
        var bi = state.order.indexOf(b.key);
        if (ai === -1) ai = -1;
        if (bi === -1) bi = -1;
        return ai - bi;
      });
    }
    stations.forEach(function(s) {
      var fid = state.assignments[s.key];
      if (fid && grouped[fid]) grouped[fid].push(s);
      else unassigned.push(s);
    });

    var scroll = ov.querySelector('.__fov-scroll');
    scroll.innerHTML = '';
    // Allow dropping anywhere in scroll to unassign from folder
    scroll.ondragover = function(e) {
      if (e.dataTransfer.types.includes('folder-drag')) return;
      e.preventDefault();
    };
    scroll.ondrop = function(e) {
      if (e.dataTransfer.types.includes('folder-drag')) return;
      var key = e.dataTransfer.getData('text/plain');
      if (!key || !state.assignments[key]) return; // only act if in a folder
      // Make sure we didn't drop on a folder header (those handle their own drop)
      var onFolder = e.target.closest('.__fov-folder-header');
      if (onFolder) return;
      e.stopPropagation();
      delete state.assignments[key];
      saveState();
      requestAnimationFrame(function() { render(); });
    };

    state.folders.forEach(function(f) {
      var isOpen = state.collapsed[f.id] === true;
      var folder = document.createElement('div');
      folder.className = '__fov-folder';

      var hdr = document.createElement('div');
      hdr.className = '__fov-folder-header';
      folder.draggable = true;
      folder.dataset.folderId = f.id;
      folder.setAttribute('data-folder-id', f.id);
      (function(fid) {
        folder.ondragstart = function(e) {
          if (dragKey) return;
          e.dataTransfer.setData('folder-drag', fid);
          e.stopPropagation();
          setTimeout(function() { folder.classList.add('folder-dragging'); }, 0);
        };
        folder.ondragend = function() {
          folder.classList.remove('folder-dragging');
          document.querySelectorAll('.__fov-folder-drop-line').forEach(function(l) { l.remove(); });
        };
        function clearDropLines() {
          document.querySelectorAll('.__fov-folder-drop-line').forEach(function(l) { l.remove(); });
        }
        folder.ondragover = function(e) {
          if (!e.dataTransfer.types.includes('folder-drag')) return;
          e.preventDefault(); e.stopPropagation();
          clearDropLines();
          var folderRect = folder.getBoundingClientRect();
          var scroll = document.querySelector('.__fov-scroll');
          var scrollRect = scroll.getBoundingClientRect();
          // Always show line at the BOTTOM of the hovered folder only
          // "before" = drop above = show at bottom of the previous sibling instead
          var insertAfter = e.clientY >= folderRect.top + folderRect.height / 2;
          folder.dataset.dropPos = insertAfter ? 'after' : 'before';
          var refFolder = insertAfter ? folder : folder.previousElementSibling;
          // Skip drop-line divs and non-folder siblings
          while (refFolder && !refFolder.classList.contains('__fov-folder')) {
            refFolder = refFolder.previousElementSibling;
          }
          var lineY = refFolder
            ? refFolder.getBoundingClientRect().bottom - scrollRect.top + scroll.scrollTop - 1
            : folderRect.top - scrollRect.top + scroll.scrollTop - 1;
          var line = document.createElement('div');
          line.className = '__fov-folder-drop-line';
          line.style.top = lineY + 'px';
          scroll.style.position = 'relative';
          scroll.appendChild(line);
        };
        folder.ondragleave = function(e) {
          if (!folder.contains(e.relatedTarget)) clearDropLines();
        };
        folder.ondrop = function(e) {
          e.preventDefault(); e.stopPropagation();
          clearDropLines();
          var fromId = e.dataTransfer.getData('folder-drag');
          if (!fromId || fromId === fid) return;
          var fromFolder = state.folders.find(function(x) { return x.id === fromId; });
          if (!fromFolder) return;
          var insertAfter = folder.dataset.dropPos === 'after';
          state.folders = state.folders.filter(function(x) { return x.id !== fromId; });
          var targetIdx = state.folders.findIndex(function(x) { return x.id === fid; });
          state.folders.splice(insertAfter ? targetIdx + 1 : targetIdx, 0, fromFolder);
          saveState();
          // Use requestAnimationFrame to avoid triggering MutationObserver mid-drag
          requestAnimationFrame(function() { render(); });
        };
      })(f.id);

      var arrow = document.createElement('span');
      arrow.className = '__fov-folder-arrow' + (isOpen ? ' open' : '');
      arrow.textContent = '\u25b6';
      var folderColor = state.folderColors[f.id] || null;
      if (folderColor) {
        folder.style.border = '1px solid ' + folderColor + '60';
        folder.style.borderLeft = '3px solid ' + folderColor;
        hdr.style.background = folderColor + '30';
        arrow.style.color = folderColor;
      } else {
        folder.style.border = '';
        folder.style.borderLeft = '';
        hdr.style.background = '';
        arrow.style.color = '';
      }

      var nameInp = document.createElement('input');
      nameInp.className = '__fov-folder-name-input';
      nameInp.dataset.id = f.id;
      nameInp.value = f.name;
      nameInp.onclick = function(e) { e.stopPropagation(); };
      nameInp.readOnly = true;
      nameInp.style.cursor = 'default';
      hdr.ondblclick = function(e) { e.stopPropagation(); nameInp.readOnly = false; nameInp.style.cursor = 'text'; nameInp.focus(); nameInp.select(); };
      nameInp.onblur = function() { nameInp.readOnly = true; nameInp.style.cursor = 'default'; f.name = nameInp.value.trim() || 'Folder'; saveState(); };
      nameInp.onclick = function(e) { if (!nameInp.readOnly) e.stopPropagation(); };
      nameInp.onkeydown = function(e) { if (e.key === 'Enter') nameInp.blur(); e.stopPropagation(); };

      var count = document.createElement('span');
      count.className = '__fov-folder-count';
      count.textContent = grouped[f.id].length;
      count.style.color = folderColor ? 'rgba(255,255,255,0.7)' : '#888';

      var del = document.createElement('button');
      del.className = '__fov-folder-del';
      del.textContent = '\u00d7';
      del.title = 'Delete folder';
      del.onclick = function(e) {
        e.stopPropagation();
        if (!confirm('Delete folder "' + f.name + '"? Stations will be unassigned.')) return;
        state.folders = state.folders.filter(function(x) { return x.id !== f.id; });
        Object.keys(state.assignments).forEach(function(k) { if (state.assignments[k] === f.id) delete state.assignments[k]; });
        saveState(); render();
      };

      var stList = document.createElement('div');
      stList.className = '__fov-folder-stations';
      stList.style.display = isOpen ? '' : 'none';

      hdr.ondragover = function(e) { if (e.dataTransfer.types.includes('folder-drag')) return; e.preventDefault(); folder.classList.add('drag-over'); };
      hdr.ondragleave = function() { folder.classList.remove('drag-over'); };
      hdr.ondrop = function(e) {
        e.preventDefault();
        folder.classList.remove('drag-over');
        var key = e.dataTransfer.getData('text/plain');
        if (key) { state.assignments[key] = f.id; saveState(); render(); }
      };
      hdr.onclick = function() {
        state.collapsed[f.id] = !state.collapsed[f.id];
        arrow.classList.toggle('open', state.collapsed[f.id]);
        stList.style.display = state.collapsed[f.id] ? '' : 'none';
        saveState();
        syncActiveHighlight(false);
      };

      var colorDot = document.createElement('div');
      colorDot.className = '__fov-color-dot';
      colorDot.style.background = folderColor || '#2e2e2e';
      colorDot.title = 'Set folder color';
      colorDot.onmousedown = function(e) { e.preventDefault(); e.stopPropagation(); };
      (function(fid, dot) { dot.onclick = function(e) { e.stopPropagation(); if (colorPickerEl) { closeColorPicker(); } else { showColorPicker(fid, dot); } }; })(f.id, colorDot);

      hdr.appendChild(arrow);
      hdr.appendChild(colorDot);
      hdr.appendChild(nameInp);
      hdr.appendChild(count);
      hdr.appendChild(del);

      (function(fid) {
        stList.ondragover = function(e) {
          if (e.dataTransfer.types.includes('folder-drag')) return;
          e.preventDefault(); e.stopPropagation();
        };
        stList.ondrop = function(e) {
          if (e.dataTransfer.types.includes('folder-drag')) return;
          e.preventDefault(); e.stopPropagation();
          var key = e.dataTransfer.getData('text/plain');
          if (!key) return;
          state.assignments[key] = fid;
          saveState();
          requestAnimationFrame(function() { render(); });
        };
      })(f.id);
      grouped[f.id].forEach(function(s) { stList.appendChild(makeRow(s, false)); });
      folder.appendChild(hdr);
      if (!stList.children.length) {
        var empty = document.createElement('div');
        empty.className = '__fov-empty';
        empty.textContent = filterText ? 'No matches' : 'Drag stations here';
        stList.appendChild(empty);
      }
      folder.appendChild(stList);
      scroll.appendChild(folder);
    });

    if (unassigned.length > 0) {
      var sec = document.createElement('div');
      sec.className = '__fov-unassigned';
      if (state.folders.length > 0) {
        var lbl = document.createElement('div');
        lbl.className = '__fov-unassigned-label';
        var lblText = document.createElement('span');
        lblText.textContent = 'All stations';
        var sortBtn = document.createElement('button');
        var sortModes = ['manual','name','location','continent'];
        var sortLabels = {'manual':'⊙ Sort','name':'⊙ A–Z','location':'⊙ By location','continent':'⊙ By continent'};
        sortBtn.className = '__fov-sort-btn' + (state.sortMode !== 'manual' ? ' active' : '');
        sortBtn.textContent = sortLabels[state.sortMode] || '⊙ Sort';
        sortBtn.onclick = function(e) {
          e.stopPropagation();
          var idx = sortModes.indexOf(state.sortMode);
          state.sortMode = sortModes[(idx + 1) % sortModes.length];
          saveState();
          render();
        };
        var compactBtn = document.createElement('button');
        compactBtn.className = '__fov-sort-btn' + (state.compact ? ' active' : '');
        compactBtn.textContent = '▤';
        compactBtn.title = 'Compact view';
        compactBtn.onclick = function(e) {
          e.stopPropagation();
          state.compact = !state.compact;
          saveState();
          var ov = document.querySelector('.__fov');
          if (ov) ov.classList.toggle('compact', state.compact);
          compactBtn.className = '__fov-sort-btn' + (state.compact ? ' active' : '');
          compactBtn.textContent = '▤';
          compactBtn.title = state.compact ? 'Switch to normal view' : 'Switch to compact view';
          compactBtn.textContent = '▤';
        };
        var btnGroup = document.createElement('div');
        btnGroup.style.cssText = 'display:flex;gap:4px;';
        btnGroup.appendChild(compactBtn);
        btnGroup.appendChild(sortBtn);
        lbl.appendChild(lblText);
        lbl.appendChild(btnGroup);
        sec.appendChild(lbl);
      }
      sec.ondragover = function(e) { e.preventDefault(); sec.classList.add('drag-over'); };
      sec.ondragleave = function() { sec.classList.remove('drag-over'); };
      sec.ondrop = function(e) {
        e.preventDefault();
        sec.classList.remove('drag-over');
        var key = e.dataTransfer.getData('text/plain');
        if (key) { delete state.assignments[key]; saveState(); render(); }
      };
      var displayUnassigned = unassigned.slice();
      function getCountry(city) {
        if (!city) return '';
        var parts = city.split(',');
        return parts.length > 1 ? parts[parts.length-1].trim() : city;
      }
      var continentMap = {'Albania':'Europe','Andorra':'Europe','Austria':'Europe','Belarus':'Europe','Belgium':'Europe','Bosnia':'Europe','Bulgaria':'Europe','Croatia':'Europe','Cyprus':'Europe','Czech':'Europe','Denmark':'Europe','Estonia':'Europe','Finland':'Europe','France':'Europe','Germany':'Europe','Greece':'Europe','Hungary':'Europe','Iceland':'Europe','Ireland':'Europe','Italy':'Europe','Kosovo':'Europe','Latvia':'Europe','Liechtenstein':'Europe','Lithuania':'Europe','Luxembourg':'Europe','Malta':'Europe','Moldova':'Europe','Monaco':'Europe','Montenegro':'Europe','Netherlands':'Europe','North Macedonia':'Europe','Norway':'Europe','Poland':'Europe','Portugal':'Europe','Romania':'Europe','Russia':'Europe','San Marino':'Europe','Serbia':'Europe','Slovakia':'Europe','Slovenia':'Europe','Spain':'Europe','Sweden':'Europe','Switzerland':'Europe','Ukraine':'Europe','United Kingdom':'Europe','UK':'Europe','Vatican':'Europe','Argentina':'Americas','Bahamas':'Americas','Barbados':'Americas','Belize':'Americas','Bolivia':'Americas','Brazil':'Americas','Canada':'Americas','Chile':'Americas','Colombia':'Americas','Costa Rica':'Americas','Cuba':'Americas','Dominican Republic':'Americas','Ecuador':'Americas','El Salvador':'Americas','Guatemala':'Americas','Guyana':'Americas','Haiti':'Americas','Honduras':'Americas','Jamaica':'Americas','Mexico':'Americas','Nicaragua':'Americas','Panama':'Americas','Paraguay':'Americas','Peru':'Americas','Puerto Rico':'Americas','Suriname':'Americas','Trinidad':'Americas','United States':'Americas','US':'Americas','Uruguay':'Americas','Venezuela':'Americas','Algeria':'Africa','Angola':'Africa','Benin':'Africa','Botswana':'Africa','Burkina Faso':'Africa','Burundi':'Africa','Cameroon':'Africa','Cape Verde':'Africa','Chad':'Africa','Congo':'Africa','Djibouti':'Africa','Egypt':'Africa','Eritrea':'Africa','Ethiopia':'Africa','Gabon':'Africa','Gambia':'Africa','Ghana':'Africa','Guinea':'Africa','Ivory Coast':'Africa','Kenya':'Africa','Lesotho':'Africa','Liberia':'Africa','Libya':'Africa','Madagascar':'Africa','Malawi':'Africa','Mali':'Africa','Mauritania':'Africa','Mauritius':'Africa','Morocco':'Africa','Mozambique':'Africa','Namibia':'Africa','Niger':'Africa','Nigeria':'Africa','Rwanda':'Africa','Senegal':'Africa','Seychelles':'Africa','Sierra Leone':'Africa','Somalia':'Africa','South Africa':'Africa','South Sudan':'Africa','Sudan':'Africa','Tanzania':'Africa','Togo':'Africa','Tunisia':'Africa','Uganda':'Africa','Zambia':'Africa','Zimbabwe':'Africa','Afghanistan':'Asia','Armenia':'Asia','Azerbaijan':'Asia','Bahrain':'Asia','Bangladesh':'Asia','Bhutan':'Asia','Brunei':'Asia','Cambodia':'Asia','China':'Asia','Georgia':'Asia','India':'Asia','Indonesia':'Asia','Iran':'Asia','Iraq':'Asia','Israel':'Asia','Japan':'Asia','Jordan':'Asia','Kazakhstan':'Asia','Kuwait':'Asia','Kyrgyzstan':'Asia','Laos':'Asia','Lebanon':'Asia','Malaysia':'Asia','Maldives':'Asia','Mongolia':'Asia','Myanmar':'Asia','Nepal':'Asia','Oman':'Asia','Pakistan':'Asia','Palestine':'Asia','Philippines':'Asia','Qatar':'Asia','Saudi Arabia':'Asia','Singapore':'Asia','South Korea':'Asia','Sri Lanka':'Asia','Syria':'Asia','Taiwan':'Asia','Tajikistan':'Asia','Thailand':'Asia','Turkey':'Asia','Turkmenistan':'Asia','UAE':'Asia','United Arab Emirates':'Asia','Uzbekistan':'Asia','Vietnam':'Asia','Yemen':'Asia','Australia':'Oceania','Fiji':'Oceania','Kiribati':'Oceania','New Zealand':'Oceania','Papua New Guinea':'Oceania','Samoa':'Oceania','Solomon Islands':'Oceania','Tonga':'Oceania','Vanuatu':'Oceania',
'Bermuda':'Americas','Trinidad and Tobago':'Americas','Martinique':'Americas','Guadeloupe':'Americas','French Guiana':'Americas','Cayman':'Americas','Aruba':'Americas','Curacao':'Americas','Virgin Islands':'Americas','Saint Martin':'Americas',
'Faroe Islands':'Europe','Greenland':'Europe','Gibraltar':'Europe','Isle of Man':'Europe','Jersey':'Europe','Guernsey':'Europe','Scotland':'Europe','Wales':'Europe','England':'Europe','Northern Ireland':'Europe','Catalonia':'Europe','Basque':'Europe','Kosovo':'Europe','Åland':'Europe',
'Réunion':'Africa','Mayotte':'Africa','Western Sahara':'Africa',
'New Caledonia':'Oceania','French Polynesia':'Oceania','Guam':'Oceania','Hawaii':'Oceania','Northern Mariana':'Oceania','Palau':'Oceania','Micronesia':'Oceania','Marshall Islands':'Oceania','Cook Islands':'Oceania','Niue':'Oceania','Tokelau':'Oceania',
'Hong Kong':'Asia','Macau':'Asia','Tibet':'Asia','Taiwan':'Asia','North Korea':'Asia','Myanmar (Burma)':'Asia'
};
      var continentOrder = ['Europe','Americas','Africa','Asia','Oceania','Other'];
      function getContinent(city) {
        var country = getCountry(city);
        for (var key in continentMap) {
          if (country.indexOf(key) !== -1 || key.indexOf(country) !== -1) return continentMap[key];
        }
        return 'Other';
      }
      // Helper: strip leading "Radio", "FM", "The" for sort key
      function sortName(name) {
        return name.replace(/^(radio|the|fm|am)\s+/i, '').trim().toLowerCase();
      }

      if (state.sortMode === 'name') {
        displayUnassigned.sort(function(a, b) {
          return sortName(a.name).localeCompare(sortName(b.name));
        });
        displayUnassigned.forEach(function(s) { sec.appendChild(makeRow(s, true)); });
      } else if (state.sortMode === 'location') {
        displayUnassigned.sort(function(a, b) {
          var ac = getCountry(a.city), bc = getCountry(b.city);
          if (ac !== bc) return ac.localeCompare(bc);
          return (a.city||'').localeCompare(b.city||'');
        });
        displayUnassigned.forEach(function(s) { sec.appendChild(makeRow(s, true)); });
      } else if (state.sortMode === 'continent') {
        displayUnassigned.sort(function(a, b) {
          var ac = getContinent(a.city), bc = getContinent(b.city);
          var ai = continentOrder.indexOf(ac), bi = continentOrder.indexOf(bc);
          if (ai !== bi) return ai - bi;
          return getCountry(a.city).localeCompare(getCountry(b.city));
        });
        var currentContinent = null;
        displayUnassigned.forEach(function(s) {
          var continent = getContinent(s.city);
          if (continent !== currentContinent) {
            currentContinent = continent;
            var hdr = document.createElement('div');
            hdr.style.cssText = 'font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#777;padding:8px 12px 3px;flex-shrink:0;';
            hdr.textContent = continent;
            sec.appendChild(hdr);
          }
          sec.appendChild(makeRow(s, true));
        });
      } else {
        unassigned.forEach(function(s) { sec.appendChild(makeRow(s, true)); });
      }
      scroll.appendChild(sec);
    }
    // Reapply highlights after render (no scroll)
    setTimeout(function() { syncActiveHighlight(false); }, 50);
    updateTitleBadge();
  }

  function makeRow(s, isUnassigned) {
    var row = document.createElement('div');
    row.className = '__fov-station' + (isUnassigned ? ' unassigned' : '');

    var info = document.createElement('div');
    info.className = '__fov-station-info';
    var n = document.createElement('div');
    n.className = '__fov-station-name';
    n.textContent = s.name;
    var c = document.createElement('div');
    c.className = '__fov-station-city';
    c.textContent = s.city;
    info.appendChild(n);
    info.appendChild(c);

    var btn = document.createElement('button');
    btn.className = '__fov-station-move';
    btn.textContent = '\ud83d\udcc1';
    btn.title = 'Move to folder';
    btn.onclick = function(e) { e.stopPropagation(); showPicker(s.key, btn); };

    var btns = document.createElement('div');
    btns.className = '__fov-station-btns';
    btns.appendChild(btn);

    row.appendChild(info);
    row.appendChild(btns);
    row.dataset.stationKey = s.key;
    // Apply active highlight if this is the active station
    if (s.key === activeKey) {
      row.style.borderLeft = '3px solid #00c864';
      row.style.paddingLeft = (isUnassigned ? '9px' : '25px');
    }
    row.draggable = true;
    row.ondragstart = function(e) {
      e.dataTransfer.setData('text/plain', s.key);
      dragKey = s.key;
      row.classList.add('dragging');
    };
    row.ondragend = function() {
      row.classList.remove('dragging');
      dragKey = null;
    };
    row.ondragover = function(e) {
      e.preventDefault(); e.stopPropagation();
      if (!dragKey || dragKey === s.key) return;
      var rect = row.getBoundingClientRect();
      var mid = rect.top + rect.height / 2;
      document.querySelectorAll('.__fov-station').forEach(function(r) { r.classList.remove('drop-above','drop-below'); });
      row.classList.add(e.clientY < mid ? 'drop-above' : 'drop-below');
    };
    row.ondragleave = function() { row.classList.remove('drop-above','drop-below'); };
    row.ondrop = function(e) {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drop-above','drop-below');
      var fromKey = e.dataTransfer.getData('text/plain');
      if (!fromKey || fromKey === s.key) return;
      var sameContext = (state.assignments[fromKey] || null) === (state.assignments[s.key] || null);
      if (!sameContext) {
        // Cross-context: move fromKey to same folder as target (or unassign if target is unassigned)
        var targetFolder = state.assignments[s.key] || null;
        if (targetFolder) state.assignments[fromKey] = targetFolder;
        else delete state.assignments[fromKey];
        saveState();
        requestAnimationFrame(function() { render(); });
        return;
      }
      // Reorder in state.order
      var rect = row.getBoundingClientRect();
      var insertAfter = e.clientY >= rect.top + rect.height / 2;
      if (!state.order.length) {
        // Build order from current DOM
        state.order = getStations().map(function(st) { return st.key; });
      }
      state.order = state.order.filter(function(k) { return k !== fromKey; });
      var targetIdx = state.order.indexOf(s.key);
      state.order.splice(insertAfter ? targetIdx + 1 : targetIdx, 0, fromKey);
      saveState();
      render();
    };
    row.onclick = function(e) {
      if (btns.contains(e.target)) return;
      activeKey = s.key;
      document.querySelectorAll('.__fov-station').forEach(function(r) {
        r.style.borderLeft = '';
        r.style.paddingLeft = '';
      });
      row.style.borderLeft = '3px solid #00c864';
      row.style.paddingLeft = (isUnassigned ? '9px' : '25px');
      s.el.click();
    };
    return row;
  }

  function mountOverlay(contentEl) {
    if (contentEl.querySelector('.__fov')) return;
    contentEl.style.position = 'relative';
    contentEl.style.overflow = 'hidden';
    document.body.dataset.fovMounted = '1';

    var ov = document.createElement('div');
    ov.className = '__fov';

    var addBtn = document.createElement('button');
    addBtn.className = '__fov-addfolder';
    addBtn.textContent = '+ New folder';
    addBtn.onclick = function() { createFolder(null); };
    // Inject next to Edit button in the native banner
    var editBtn = document.querySelector('[data-id="edit-button"]');
    if (editBtn) {
      addBtn.className = editBtn.className + ' __fov-addfolder';
      addBtn.innerHTML = '<div class="' + (editBtn.querySelector('div') ? editBtn.querySelector('div').className : '') + '">+ New folder</div>';
      editBtn.parentElement.insertBefore(addBtn, editBtn);
      editBtn.style.display = 'none';
    }

    var searchWrap = document.createElement('div');
    searchWrap.className = '__fov-search-wrap';

    var searchInput = document.createElement('input');
    searchInput.className = '__fov-search';
    searchInput.placeholder = 'Search stations…';
    searchInput.setAttribute('type', 'text');

    var clearBtn = document.createElement('button');
    clearBtn.className = '__fov-search-clear';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Clear search';
    clearBtn.tabIndex = -1;
    clearBtn.onmousedown = function(e) { e.preventDefault(); }; // prevent input blur
    clearBtn.onclick = function() {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      searchInput.focus();
      render();
    };

    searchInput.oninput = function() {
      clearBtn.style.display = searchInput.value ? 'block' : 'none';
      render();
    };
    searchInput.onkeydown = function(e) {
      e.stopPropagation();
      if (e.key === 'Escape') { searchInput.value = ''; clearBtn.style.display = 'none'; render(); }
    };

    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(clearBtn);

    var scroll = document.createElement('div');
    scroll.className = '__fov-scroll';

    ov.appendChild(searchWrap);
    ov.appendChild(scroll);

    // Prevent drawer collapse during drag operations
    function freezeDrawer() {
      document.querySelectorAll('[data-drawer="scroll"]').forEach(function(el) {
        el.dataset.drawerFrozen = el.getAttribute('data-drawer');
        el.removeAttribute('data-drawer');
      });
    }
    function thawDrawer() {
      document.querySelectorAll('[data-drawer-frozen]').forEach(function(el) {
        el.setAttribute('data-drawer', el.dataset.drawerFrozen);
        delete el.dataset.drawerFrozen;
      });
    }
    ov.addEventListener('dragstart', freezeDrawer);
    ov.addEventListener('dragend', function() { setTimeout(thawDrawer, 300); });

    // Also freeze on mousedown so fast drags are caught before dragstart fires
    // Block scroll/pointer events from reaching the drawer at all times
    ['wheel','touchmove','touchstart','pointermove','pointerdown'].forEach(function(evt) {
      ov.addEventListener(evt, function(e) { e.stopPropagation(); }, { passive: false, capture: false });
    });

    ov.addEventListener('mousedown', function() {
      freezeDrawer();
      var thawTimer = setTimeout(thawDrawer, 500);
      ov.addEventListener('dragstart', function cancelThaw() {
        clearTimeout(thawTimer);
        ov.removeEventListener('dragstart', cancelThaw);
      }, { once: true });
      document.addEventListener('mouseup', function onUp() {
        setTimeout(thawDrawer, 300);
        document.removeEventListener('mouseup', onUp);
      }, { once: true });
    });
    contentEl.appendChild(ov);

    // Local keyboard navigation (scoped to overlay, not global)
    ov.setAttribute('tabindex', '-1');
    document.addEventListener('keydown', function fovKeys(e) {
      // Only active when favorites is mounted and search not focused
      if (!document.body.dataset.fovMounted) {
        document.removeEventListener('keydown', fovKeys);
        return;
      }
      if (document.activeElement === searchInput) return;
      // Only navigate visible rows - skip those inside collapsed folders
      var rows = Array.from(document.querySelectorAll('.__fov-station')).filter(function(r) {
        return r.offsetParent !== null;
      });
      if (!rows.length) return;
      var activeRow = rows.findIndex(function(r) { return r.dataset.stationKey === activeKey; });
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        var next = rows[activeRow + 1] || rows[0];
        next.click();
        (function(t) { var s = document.querySelector('.__fov-scroll'); if (s) s.scrollTo({ top: t.offsetTop - s.offsetHeight/2 + t.offsetHeight/2, behavior: 'smooth' }); })(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        var prev = rows[activeRow - 1] || rows[rows.length - 1];
        prev.click();
        (function(t) { var s = document.querySelector('.__fov-scroll'); if (s) s.scrollTo({ top: t.offsetTop - s.offsetHeight/2 + t.offsetHeight/2, behavior: 'smooth' }); })(prev);
      } else if (e.key === 'Enter' && activeRow >= 0) {
        e.preventDefault();
        rows[activeRow].click();
      } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    render();
    // Watch for station list changes (add/remove favorites)
    var stationObserver = new MutationObserver(function() { if (!pauseObserver) render(); });
    var stationsContainer = contentEl.querySelector('[class*=_hideFirstTop]');
    if (stationsContainer) stationObserver.observe(stationsContainer, { childList: true, subtree: true });
  }

  function isFavoritesActive() {
    // URL is the most reliable signal - Radio Garden uses hash/path routing
    var href = window.location.href;
    if (href.includes('/favourites') || href.includes('/favorites')) return true;
    // Check nav active class - but NOT edit button (too unreliable during transitions)
    var favNav = Array.from(document.querySelectorAll('[class*=_navItem], [class*=_tab], [class*=_nav] a, [class*=_nav] button, nav a, nav button'))
      .find(function(el) { return el.innerText && el.innerText.trim().toLowerCase() === 'favorites'; });
    if (favNav) {
      return favNav.getAttribute('aria-selected') === 'true' ||
        /active|selected|current|_active/.test(favNav.className);
    }
    return false;
  }

  function unmountOverlay() {
    delete document.body.dataset.fovMounted;
    closeColorPicker();
    var titleEl = document.querySelector('[id="bht"]');
    if (titleEl) { var b = titleEl.querySelector('.__fov-title-badge'); if (b) b.remove(); }
    var ov = document.querySelector('.__fov');
    if (ov) ov.remove();
    // Restore overflow on content element
    var contentEl = document.querySelector('[data-id="page-content"]');
    if (contentEl) { contentEl.style.overflow = ''; contentEl.style.position = ''; }
    var editBtn = document.querySelector('[data-id="edit-button"]');
    if (editBtn) editBtn.style.display = '';
    document.querySelectorAll('.__fov-addfolder').forEach(function(b) { b.remove(); });
    document.querySelectorAll('.__fov-picker').forEach(function(p) { p.remove(); });
  }

  function check() {
    var contentEl = document.querySelector('[data-id="page-content"]');
    if (!contentEl) { unmountOverlay(); return; }
    if (isFavoritesActive() && getStations().length > 0) {
      var alreadyMounted = !!contentEl.querySelector('.__fov');
      mountOverlay(contentEl);
      // If overlay was already there, still do the scroll pin check on tab entry
      if (alreadyMounted && activeKey && activeKey !== lastScrolledKey) {
        needsPin = true;
        setTimeout(function() { syncActiveHighlight(true); }, 400);
      }
    } else if (!isFavoritesActive()) {
      unmountOverlay();
    }
  }

  function onNavigate() {
    // Always check after navigation, with a delay to let SPA render settle
    setTimeout(function() {
      if (!isFavoritesActive()) {
        unmountOverlay();
      } else {
        check();
      }
    }, 200);
    // Also check sooner for the unmount case
    setTimeout(function() {
      if (!isFavoritesActive()) unmountOverlay();
    }, 50);
  }

  loadState().then(function() {
    // hashchange/popstate fire immediately and reliably on tab navigation
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('popstate', onNavigate);

    // MutationObserver as fallback for SPA navigation that doesn't change URL
    new MutationObserver(function() {
      if (document.body.dataset.fovMounted && !isFavoritesActive()) {
        unmountOverlay();
      } else if (!document.body.dataset.fovMounted && isFavoritesActive()) {
        check();
      }
    }).observe(document.body, { childList: true, subtree: true });

    // Click listener with slightly longer delay to let routing settle
    document.addEventListener('click', function() {
      if (pauseObserver) return;
      setTimeout(onNavigate, 250);
    });

    // Poll now-playing to sync active highlight from any source
    setInterval(function() { syncActiveHighlight(false); }, 800);

    // URL polling fallback - catches SPA navigation that doesn't fire hashchange/popstate
    var lastUrl = window.location.href;
    setInterval(function() {
      var currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        onNavigate();
      }
    }, 200);

    check();
  });
})();
