(function() {

  var CYAN = '#00D4FF';

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getItems() {
    return Array.isArray(window.selectedItems) ? window.selectedItems : [];
  }

  function getTotal() {
    return typeof window.currentTotal === 'number' ? window.currentTotal : 0;
  }

  function toast(msg, err) {
    if (typeof window.showToast === 'function') window.showToast(msg, err);
  }

  /* ───────────────────────────────────────────────────
     FEATURE 1 — BUDGET GOAL TRACKER
  ─────────────────────────────────────────────────── */
  function injectBudgetTracker() {
    var panel = document.querySelector('.build-panel');
    if (!panel || document.getElementById('bmBudgetTracker')) return;

    var saved = parseInt(localStorage.getItem('bm-budget-goal') || '0');

    var wrap = document.createElement('div');
    wrap.id = 'bmBudgetTracker';
    wrap.style.cssText = 'background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.12);border-radius:12px;padding:12px 14px;margin:8px 0;';
    wrap.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
        '<span style="font-size:11px;font-weight:700;color:' + CYAN + ';letter-spacing:.06em;text-transform:uppercase;"><i class="fas fa-bullseye" style="margin-right:5px;"></i>Budget Goal</span>' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span style="font-size:10px;color:#2a4560;">₱</span>' +
          '<input id="bmBudgetInput" type="number" min="0" step="1000" value="' + (saved || '') + '" placeholder="Set budget..." ' +
            'style="width:90px;background:#080C14;border:1px solid #1a2840;border-radius:6px;color:#D8EEFF;padding:4px 8px;font-size:11px;font-weight:700;font-family:inherit;outline:none;" />' +
        '</div>' +
      '</div>' +
      '<div style="background:#0e1520;border-radius:6px;height:7px;overflow:hidden;margin-bottom:6px;">' +
        '<div id="bmBudgetBar" style="height:100%;width:0%;border-radius:6px;background:' + CYAN + ';transition:width .4s,background .4s;"></div>' +
      '</div>' +
      '<div id="bmBudgetLabel" style="font-size:10px;color:#2a4560;text-align:right;"></div>';

    var totalCostEl = panel.querySelector('.total-cost');
    if (totalCostEl) {
      totalCostEl.parentNode.insertBefore(wrap, totalCostEl.nextSibling);
    } else {
      panel.appendChild(wrap);
    }

    document.getElementById('bmBudgetInput').addEventListener('input', function() {
      localStorage.setItem('bm-budget-goal', this.value || '0');
      updateBudgetBar();
    });

    updateBudgetBar();
  }

  function updateBudgetBar() {
    var bar = document.getElementById('bmBudgetBar');
    var label = document.getElementById('bmBudgetLabel');
    var input = document.getElementById('bmBudgetInput');
    if (!bar || !label || !input) return;

    var goal = parseInt(input.value || '0');
    var spent = getTotal();

    if (!goal) {
      bar.style.width = '0%';
      label.textContent = '';
      return;
    }

    var pct = Math.min(100, Math.round((spent / goal) * 100));
    var remaining = goal - spent;
    var color = pct < 70 ? '#22C55E' : pct < 90 ? '#F97316' : '#EF4444';

    bar.style.width = pct + '%';
    bar.style.background = color;

    if (remaining >= 0) {
      label.innerHTML = '<span style="color:' + color + ';">' + pct + '%</span> · <span style="color:#22C55E;">₱' + Math.abs(remaining).toLocaleString() + ' left</span>';
    } else {
      label.innerHTML = '<span style="color:#EF4444;">Over by ₱' + Math.abs(remaining).toLocaleString() + '</span>';
    }
  }

  /* ───────────────────────────────────────────────────
     FEATURE 2 — RECENTLY VIEWED PRODUCTS
  ─────────────────────────────────────────────────── */
  var RECENT_KEY = 'bm-recently-viewed';
  var MAX_RECENT = 8;

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch(e) { return []; }
  }

  function saveRecent(list) {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  }

  function trackProductView(name, price, category, img) {
    var list = getRecent();
    list = list.filter(function(p) { return p.name !== name; });
    list.unshift({ name: name, price: price, category: category, img: img || 'assets/placeholder.svg' });
    saveRecent(list);
  }

  function injectRecentlyViewed() {
    var sidebar = document.querySelector('.builder-sidebar');
    if (!sidebar || document.getElementById('bmRecentPanel')) return;

    var panel = document.createElement('div');
    panel.id = 'bmRecentPanel';
    panel.style.cssText = 'margin-top:16px;border-top:1px solid #1a2840;padding-top:14px;';
    panel.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:' + CYAN + ';letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;"><i class="fas fa-history" style="margin-right:5px;"></i>Recently Viewed</div>' +
      '<div id="bmRecentList" style="display:flex;flex-direction:column;gap:5px;"></div>';

    sidebar.appendChild(panel);
    renderRecentlyViewed();
  }

  function renderRecentlyViewed() {
    var listEl = document.getElementById('bmRecentList');
    if (!listEl) return;

    var list = getRecent();
    if (!list.length) {
      listEl.innerHTML = '<div style="font-size:11px;color:#2a4560;">No products viewed yet.</div>';
      return;
    }

    listEl.innerHTML = list.map(function(p) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;cursor:pointer;transition:background .15s;" ' +
        'onmouseover="this.style.background=\'rgba(0,212,255,0.06)\'" onmouseout="this.style.background=\'transparent\'" ' +
        'onclick="bmScrollToProduct(\'' + esc(p.name) + '\')">' +
        '<img src="' + esc(p.img) + '" onerror="this.src=\'assets/placeholder.svg\'" ' +
          'style="width:32px;height:32px;object-fit:contain;border-radius:5px;background:#0e1520;flex-shrink:0;">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:10px;font-weight:700;color:#D8EEFF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(p.name) + '</div>' +
          '<div style="font-size:10px;color:' + CYAN + ';">₱' + Number(p.price).toLocaleString() + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  window.bmScrollToProduct = function(name) {
    var cards = document.querySelectorAll('.product-card');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].dataset.name === name) {
        cards[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
        cards[i].style.outline = '2px solid ' + CYAN;
        setTimeout(function(c) { c.style.outline = ''; }, 1500, cards[i]);
        return;
      }
    }
    toast('Product not visible in current view — try browsing its category', true);
  };

  function hookProductCardClicks() {
    document.addEventListener('click', function(e) {
      var card = e.target.closest('.product-card');
      if (!card) return;
      var name = card.dataset.name;
      var price = card.dataset.price;
      var category = card.dataset.category;
      var img = card.querySelector('img') ? card.querySelector('img').src : '';
      if (name) {
        trackProductView(name, price, category, img);
        renderRecentlyViewed();
      }
    });
  }

  /* ───────────────────────────────────────────────────
     FEATURE 3 — WHATSAPP SHARE
  ─────────────────────────────────────────────────── */
  function injectWhatsAppShare() {
    var shareBtn = document.querySelector('.share-btn');
    if (!shareBtn || document.getElementById('bmWaShareBtn')) return;

    var btn = document.createElement('button');
    btn.id = 'bmWaShareBtn';
    btn.className = 'share-btn';
    btn.style.cssText = 'background:rgba(37,211,102,0.1);border-color:rgba(37,211,102,0.25);color:#25D166;margin-top:6px;width:100%;';
    btn.innerHTML = '<i class="fab fa-whatsapp" style="font-size:15px;"></i> Share via WhatsApp';
    btn.onclick = shareViaWhatsApp;

    shareBtn.parentNode.insertBefore(btn, shareBtn.nextSibling);
  }

  function shareViaWhatsApp() {
    var items = getItems();
    if (!items.length) { toast('Add parts to your build first!', true); return; }

    var lines = ['🖥️ *My BuildMatrix PC Build*\n'];
    var catLabels = { cpu:'CPU', gpu:'GPU', motherboard:'Motherboard', ram:'RAM', ssd:'Storage', psu:'PSU', case:'Case', monitor:'Monitor', fan:'Fan' };

    items.forEach(function(item) {
      var cat = catLabels[item.category] || item.category.toUpperCase();
      lines.push('*' + cat + ':* ' + item.name + ' — ₱' + Number(item.price * (item.qty||1)).toLocaleString());
    });

    lines.push('\n💰 *Total: ₱' + getTotal().toLocaleString() + '*');
    lines.push('\n🔗 Built with BuildMatrix — buildmatrix.app');

    var text = lines.join('\n');
    var url = 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank');
  }

  /* ───────────────────────────────────────────────────
     FEATURE 4 — KEYBOARD SHORTCUTS
  ─────────────────────────────────────────────────── */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        var search = document.getElementById('productSearch');
        if (search) { search.focus(); search.select(); }
        return;
      }

      if (e.key === 'Escape') {
        var search = document.getElementById('productSearch');
        if (document.activeElement === search) {
          search.blur();
          search.value = '';
          if (typeof window.applyAllFilters === 'function') window.applyAllFilters();
        }
        return;
      }

      if (isInput) return;

      if (e.key === 's' || e.key === 'S') {
        if (typeof window.saveCurrentBuild === 'function') window.saveCurrentBuild();
        return;
      }

      if (e.key === '?' ) {
        showShortcutsModal();
        return;
      }
    });

    injectShortcutHint();
  }

  function injectShortcutHint() {
    var search = document.getElementById('productSearch');
    if (!search || document.getElementById('bmShortcutHint')) return;
    var hint = document.createElement('div');
    hint.id = 'bmShortcutHint';
    hint.innerHTML = 'Press <kbd style="background:#0e1520;border:1px solid #1a2840;border-radius:4px;padding:1px 5px;font-size:10px;color:' + CYAN + ';">/</kbd> to focus search · <kbd style="background:#0e1520;border:1px solid #1a2840;border-radius:4px;padding:1px 5px;font-size:10px;color:' + CYAN + ';">S</kbd> to save · <kbd style="background:#0e1520;border:1px solid #1a2840;border-radius:4px;padding:1px 5px;font-size:10px;color:' + CYAN + ';">?</kbd> for help';
    hint.style.cssText = 'font-size:10px;color:#2a4560;margin-top:5px;line-height:1.8;';
    search.parentNode.parentNode.appendChild(hint);
  }

  function showShortcutsModal() {
    var old = document.getElementById('bmShortcutsModal');
    if (old) { old.remove(); return; }
    var shortcuts = [
      ['/', 'Focus search box'],
      ['Esc', 'Clear search'],
      ['S', 'Save current build'],
      ['?', 'Toggle this help panel']
    ];
    var rows = shortcuts.map(function(s) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a2840;">' +
        '<span style="font-size:12px;color:#5a8aaa;">' + s[1] + '</span>' +
        '<kbd style="background:#0e1520;border:1px solid rgba(0,212,255,0.2);border-radius:6px;padding:3px 10px;font-size:11px;color:' + CYAN + ';font-family:inherit;">' + s[0] + '</kbd>' +
      '</div>';
    }).join('');

    var modal = document.createElement('div');
    modal.id = 'bmShortcutsModal';
    modal.style.cssText = 'position:fixed;bottom:80px;right:24px;background:#0e1520;border:1px solid rgba(0,212,255,0.2);border-radius:14px;padding:16px 18px;z-index:9999;min-width:240px;box-shadow:0 20px 50px rgba(0,0,0,0.7);animation:bmFadeIn .2s ease;';
    modal.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
        '<span style="font-size:11px;font-weight:700;color:' + CYAN + ';letter-spacing:.06em;text-transform:uppercase;">Keyboard Shortcuts</span>' +
        '<button onclick="document.getElementById(\'bmShortcutsModal\').remove()" style="background:none;border:none;color:#5a8aaa;cursor:pointer;font-size:16px;">×</button>' +
      '</div>' + rows;

    document.body.appendChild(modal);
    setTimeout(function() { document.addEventListener('click', function closeShortcuts(ev) { if (!modal.contains(ev.target)) { modal.remove(); document.removeEventListener('click', closeShortcuts); } }); }, 100);
  }

  /* ───────────────────────────────────────────────────
     FEATURE 5 — TEXT EXPORT (copy to clipboard)
  ─────────────────────────────────────────────────── */
  function injectTextExport() {
    var btnGrid = document.querySelector('.build-actions');
    if (!btnGrid || document.getElementById('bmTextExportBtn')) return;

    var btn = document.createElement('button');
    btn.id = 'bmTextExportBtn';
    btn.className = 'action-btn';
    btn.style.cssText = 'background:rgba(0,212,255,0.07);border:1px solid rgba(0,212,255,0.18);color:#5a8aaa;';
    btn.innerHTML = '<i class="fas fa-copy"></i> Copy List';
    btn.onclick = copyBuildAsText;
    btnGrid.appendChild(btn);
  }

  function copyBuildAsText() {
    var items = getItems();
    if (!items.length) { toast('Add parts first!', true); return; }

    var catLabels = { cpu:'CPU', gpu:'GPU', motherboard:'Motherboard', ram:'RAM', ssd:'Storage', psu:'PSU', case:'Case', monitor:'Monitor', fan:'Fan', keyboard:'Keyboard', mouse:'Mouse' };
    var lines = ['BUILDMATRIX PC BUILD', '='.repeat(30)];

    items.forEach(function(item) {
      var cat = catLabels[item.category] || item.category.toUpperCase();
      var qty = item.qty > 1 ? ' x' + item.qty : '';
      lines.push(cat + ': ' + item.name + qty + ' — P' + Number(item.price * (item.qty||1)).toLocaleString());
    });

    lines.push('='.repeat(30));
    lines.push('TOTAL: P' + getTotal().toLocaleString());
    lines.push('Built with BuildMatrix');

    var text = lines.join('\n');

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function() { toast('Build copied to clipboard!'); }).catch(function() { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Build copied to clipboard!'); } catch(e) { toast('Could not copy', true); }
    ta.remove();
  }

  /* ───────────────────────────────────────────────────
     FEATURE 6 — BUILD TIMER
  ─────────────────────────────────────────────────── */
  var buildStartTime = null;
  var timerInterval = null;

  function startBuildTimer() {
    buildStartTime = Date.now();
    timerInterval = setInterval(updateTimerDisplay, 1000);
  }

  function updateTimerDisplay() {
    var el = document.getElementById('bmBuildTimer');
    if (!el || !buildStartTime) return;
    var elapsed = Math.floor((Date.now() - buildStartTime) / 1000);
    var m = Math.floor(elapsed / 60);
    var s = elapsed % 60;
    el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function injectBuildTimer() {
    var buildHeader = document.querySelector('.build-header');
    if (!buildHeader || document.getElementById('bmBuildTimer')) return;

    var timerWrap = document.createElement('div');
    timerWrap.style.cssText = 'font-size:10px;color:#2a4560;display:flex;align-items:center;gap:4px;';
    timerWrap.innerHTML = '<i class="fas fa-stopwatch" style="color:rgba(0,212,255,0.3);"></i><span id="bmBuildTimer">00:00</span>';
    buildHeader.appendChild(timerWrap);

    startBuildTimer();
  }

  /* ───────────────────────────────────────────────────
     FEATURE 7 — FLOATING SHORTCUT BUTTON
  ─────────────────────────────────────────────────── */
  function injectFloatingBtn() {
    if (document.getElementById('bmFloatingBtn')) return;

    var btn = document.createElement('button');
    btn.id = 'bmFloatingBtn';
    btn.title = 'Keyboard shortcuts (?)';
    btn.innerHTML = '<i class="fas fa-keyboard"></i>';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:44px;height:44px;border-radius:50%;' +
      'background:rgba(0,212,255,0.1);border:1px solid rgba(0,212,255,0.25);color:' + CYAN + ';' +
      'cursor:pointer;z-index:9000;font-size:16px;display:flex;align-items:center;justify-content:center;' +
      'transition:all .2s;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
    btn.onmouseover = function() { this.style.background = 'rgba(0,212,255,0.18)'; this.style.transform = 'scale(1.1)'; };
    btn.onmouseout  = function() { this.style.background = 'rgba(0,212,255,0.1)'; this.style.transform = ''; };
    btn.onclick = showShortcutsModal;
    document.body.appendChild(btn);
  }

  /* ───────────────────────────────────────────────────
     HOOK INTO updateBuildDisplay
  ─────────────────────────────────────────────────── */
  function hookUpdateBuildDisplay() {
    var orig = window.updateBuildDisplay;
    if (typeof orig !== 'function') return;
    window.updateBuildDisplay = function() {
      orig.apply(this, arguments);
      updateBudgetBar();
    };
  }

  /* ───────────────────────────────────────────────────
     INJECT GLOBAL CSS
  ─────────────────────────────────────────────────── */
  function injectStyles() {
    var style = document.createElement('style');
    style.textContent =
      '@keyframes bmFadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }' +
      '#bmBudgetInput:focus { border-color:rgba(0,212,255,0.4) !important; outline:none; }' +
      '#bmFloatingBtn { animation: rgb-border 5s linear infinite; }' +
      '.bm-feature-toast { animation: bmFadeIn .3s ease; }';
    document.head.appendChild(style);
  }

  /* ───────────────────────────────────────────────────
     INIT ALL FEATURES
  ─────────────────────────────────────────────────── */
  function init() {
    injectStyles();
    injectBudgetTracker();
    injectRecentlyViewed();
    injectWhatsAppShare();
    initKeyboardShortcuts();
    injectTextExport();
    injectBuildTimer();
    injectFloatingBtn();
    hookProductCardClicks();
    hookUpdateBuildDisplay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 600); });
  } else {
    setTimeout(init, 600);
  }

})();