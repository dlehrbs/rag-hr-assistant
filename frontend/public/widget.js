(function () {
  'use strict';

  // ── 설정 ──────────────────────────────────────────────────────────────────
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  var API_BASE = (script.getAttribute('data-api') || '').replace(/\/$/, '');
  if (!API_BASE) {
    var src = script.src || '';
    API_BASE = src.substring(0, src.lastIndexOf('/'));
  }

  var TITLE    = script.getAttribute('data-title')    || 'DY HR Chatbot';
  var SUBTITLE = script.getAttribute('data-subtitle') || '취업규칙 · 인사규정 안내';
  var _rawColor = script.getAttribute('data-color') || '';
  var COLOR    = /^#[0-9a-fA-F]{6}$/.test(_rawColor) ? _rawColor : '#2563eb';
  var _rawW = parseInt(script.getAttribute('data-width'),  10);
  var _rawH = parseInt(script.getAttribute('data-height'), 10);
  var CUSTOM_W = (_rawW >= 280 && _rawW <= 900) ? _rawW + 'px' : null;
  var CUSTOM_H = (_rawH >= 300 && _rawH <= 1000) ? _rawH + 'px' : null;

  var guestToken            = null;
  var isOpen                = false;
  var isLoading             = false;
  var chatHistory           = [];
  var sizeState             = 'normal';
  var currentAbortController = null;
  var _vvActive = false;
  var webSearchEnabled      = false;

  var SVG_CHAT  = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var SVG_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var SVG_MOON  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SVG_SUN   = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

  var isDark = false;

  var _normW = CUSTOM_W || '360px';
  var _normH = CUSTOM_H || '520px';
  var SIZES = {
    normal:    { width: 'min('+_normW+', calc(100vw - 16px))', height: _normH,                bottom: '90px', right: '24px', borderRadius: '16px' },
    expanded:  { width: 'min(520px, calc(100vw - 16px))',      height: '700px',               bottom: '90px', right: '24px', borderRadius: '16px' },
    maximized: { width: 'calc(100vw - 32px)',                  height: 'calc(100vh - 100px)', bottom: '90px', right: '16px', borderRadius: '12px' },
  };

  // ── 마크다운 렌더러 (줄 단위 파서, XSS 안전) ───────────────────────────────

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inlineFormat(s) {
    s = escHtml(s);
    s = s.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__(.+?)__/g,     '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`\n]+)`/g,   '<code class="dy-code">$1</code>');
    // 마크다운 링크 [text](url) → 클릭 가능한 링크
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a class="dy-web-link" href="$2" target="_blank" rel="noopener">$1 &#x2197;</a>');
    s = s.replace(/📄 (.*?\.pdf)\s*(?:\(p\.(\d+)\))?([^<\n]*)/g, function (_, fname, page, rest) {
      var encoded = encodeURIComponent(fname.trim());
      var hash = page ? '#page=' + page : '';
      var label = page ? ' p.' + page : '';
      return '<a class="dy-src-link" href="' + API_BASE + '/api/docs/' + encoded + hash + '" target="_blank" rel="noopener">📄 ' + fname.trim() + label + (rest ? rest : '') + ' &#x2197;</a>';
    });
    return s;
  }

  function isSepRow(row) {
    return row.trim().replace(/\|/g, '').trim().replace(/[-:\s]/g, '') === '';
  }

  function renderTable(rows) {
    var dataRows = rows.filter(function(r) { return !isSepRow(r); });
    if (dataRows.length === 0) return '';
    var html = '<table class="dy-table"><thead><tr>';
    var parseCells = function(r) {
      return r.trim().replace(/^\||\|$/g, '').split('|').map(function(c) { return c.trim(); });
    };
    parseCells(dataRows[0]).forEach(function(h) {
      html += '<th>' + inlineFormat(h) + '</th>';
    });
    html += '</tr></thead>';
    if (dataRows.length > 1) {
      html += '<tbody>';
      dataRows.slice(1).forEach(function(row) {
        html += '<tr>';
        parseCells(row).forEach(function(c) {
          html += '<td>' + inlineFormat(c) + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody>';
    }
    return html + '</table>';
  }

  function renderMarkdown(raw) {
    var lines  = raw.replace(/\\n/g, '\n').split('\n');
    var out    = [];
    var ulOpen = false;
    var olOpen = false;
    var i = 0;

    function closeList() {
      if (ulOpen) { out.push('</ul>'); ulOpen = false; }
      if (olOpen) { out.push('</ol>'); olOpen = false; }
    }

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      // ── 표: | 로 시작하는 연속 줄 묶음 ──────────────────────────
      if (trimmed.startsWith('|')) {
        closeList();
        var tableRows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          tableRows.push(lines[i]);
          i++;
        }
        out.push(renderTable(tableRows));
        continue;
      }

      // ── 수평선 ───────────────────────────────────────────────────
      if (/^---+$/.test(trimmed)) {
        closeList();
        out.push('<hr class="dy-hr">');
        i++; continue;
      }

      // ── 헤딩 ─────────────────────────────────────────────────────
      var hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        closeList();
        var lvl = hMatch[1].length;
        out.push('<div class="dy-h dy-h' + lvl + '">' + inlineFormat(hMatch[2]) + '</div>');
        i++; continue;
      }

      // ── 불릿 리스트 (* - +) ──────────────────────────────────────
      var ulMatch = trimmed.match(/^[\*\-\+]\s+(.+)$/);
      if (ulMatch) {
        if (olOpen) { out.push('</ol>'); olOpen = false; }
        if (!ulOpen) { out.push('<ul class="dy-ul">'); ulOpen = true; }
        out.push('<li>' + inlineFormat(ulMatch[1]) + '</li>');
        i++; continue;
      }

      // ── 번호 리스트 (1. 2. ...) ──────────────────────────────────
      var olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (olMatch) {
        if (ulOpen) { out.push('</ul>'); ulOpen = false; }
        if (!olOpen) { out.push('<ol class="dy-ol">'); olOpen = true; }
        out.push('<li>' + inlineFormat(olMatch[2]) + '</li>');
        i++; continue;
      }

      // ── 빈 줄 ────────────────────────────────────────────────────
      if (trimmed === '') {
        closeList();
        out.push('<div class="dy-gap"></div>');
        i++; continue;
      }

      // ── 일반 텍스트 ───────────────────────────────────────────────
      closeList();
      out.push('<div class="dy-line">' + inlineFormat(trimmed) + '</div>');
      i++;
    }

    closeList();
    return out.join('');
  }

  // ── 스타일 ────────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#dy-widget-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;border:none;cursor:pointer;font-size:26px;box-shadow:0 4px 16px rgba(0,0,0,0.25);z-index:99998;display:flex;align-items:center;justify-content:center;transition:transform .15s,background .15s;}',
    '#dy-widget-btn:hover{background:#1d4ed8;transform:scale(1.08);}',

    '#dy-widget-panel{position:fixed;background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.18);z-index:99999;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;transition:width .22s ease,height .22s ease;}',
    '#dy-widget-panel.open{display:flex;}',

    '#dy-widget-header{background:#2563eb;color:#fff;padding:12px 14px;font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:6px;}',
    '#dy-widget-header .dy-title-area{flex:1;min-width:0;}',
    '#dy-widget-header .dy-title-area span{display:block;opacity:.75;font-size:11px;font-weight:400;margin-top:2px;}',
    '#dy-widget-header .dy-header-btns{display:flex;gap:4px;flex-shrink:0;}',
    '.dy-hbtn{background:rgba(255,255,255,0.15);border:none;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background .12s;}',
    '.dy-hbtn:hover{background:rgba(255,255,255,0.3);}',
    '.dy-hbtn.active{background:rgba(255,255,255,0.35);}',

    '#dy-widget-messages{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;}',

    '.dy-msg{max-width:90%;padding:10px 13px;border-radius:12px;line-height:1.65;word-break:break-word;}',
    '.dy-msg-user{background:#2563eb;color:#fff;align-self:flex-end;border-bottom-right-radius:4px;}',
    '.dy-msg-bot{background:#f1f5f9;color:#1e293b;align-self:flex-start;border-bottom-left-radius:4px;}',
    '.dy-msg-bot strong{font-weight:600;color:#0f172a;}',
    '.dy-msg-bot em{font-style:italic;}',
    '.dy-msg-bot .dy-hr{border:none;border-top:1px solid #cbd5e1;margin:8px 0;}',
    '.dy-msg-bot .dy-code{background:#e2e8f0;padding:1px 5px;border-radius:4px;font-size:12px;font-family:monospace;}',
    '.dy-msg-bot .dy-src{color:#475569;font-size:13px;}',
    /* 줄/여백 */
    '.dy-msg-bot .dy-line{margin:2px 0;line-height:1.65;}',
    '.dy-msg-bot .dy-gap{height:8px;}',
    /* 헤딩 */
    '.dy-msg-bot .dy-h{font-weight:700;color:#0f172a;margin:12px 0 4px;}',
    '.dy-msg-bot .dy-h1{font-size:17px;}',
    '.dy-msg-bot .dy-h2{font-size:16px;}',
    '.dy-msg-bot .dy-h3{font-size:15px;}',
    '.dy-msg-bot .dy-h4{font-size:14px;color:#1e3a5f;}',
    '.dy-msg-bot .dy-h5,.dy-msg-bot .dy-h6{font-size:13px;color:#334155;}',
    /* 리스트 */
    '.dy-msg-bot .dy-ul,.dy-msg-bot .dy-ol{margin:4px 0 4px 18px;padding:0;}',
    '.dy-msg-bot .dy-ul li{list-style:disc;margin:2px 0;line-height:1.6;}',
    '.dy-msg-bot .dy-ol li{list-style:decimal;margin:2px 0;line-height:1.6;}',
    /* 표 */
    '.dy-msg-bot .dy-table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12.5px;border-radius:6px;overflow:hidden;}',
    '.dy-msg-bot .dy-table th{background:#dbeafe;color:#1e3a5f;font-weight:600;padding:6px 10px;text-align:left;border:1px solid #bfdbfe;white-space:nowrap;}',
    '.dy-msg-bot .dy-table td{padding:5px 10px;border:1px solid #e2e8f0;vertical-align:top;}',
    '.dy-msg-bot .dy-table tr:nth-child(even) td{background:#f8fafc;}',

    '.dy-msg-bot.streaming::after{content:"▋";display:inline-block;animation:dy-blink .7s infinite;vertical-align:middle;color:#94a3b8;font-size:12px;margin-left:2px;}',
    '@keyframes dy-blink{0%,100%{opacity:1;}50%{opacity:0;}}',

    '.dy-thinking{display:flex;align-items:center;gap:6px;align-self:flex-start;padding:8px 12px;background:#f8fafc;border-radius:12px;border-bottom-left-radius:4px;color:#94a3b8;font-size:13px;}',
    '.dy-thinking-dots{display:flex;gap:3px;}',
    '.dy-thinking-dots span{width:5px;height:5px;background:#94a3b8;border-radius:50%;animation:dy-dot .9s infinite;}',
    '.dy-thinking-dots span:nth-child(2){animation-delay:.15s;}',
    '.dy-thinking-dots span:nth-child(3){animation-delay:.3s;}',
    '@keyframes dy-dot{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-4px);opacity:1;}}',

    '#dy-widget-disclaimer{padding:5px 12px;font-size:11px;color:#94a3b8;text-align:center;flex-shrink:0;background:#fff;}',
    '#dy-widget-footer{padding:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;flex-shrink:0;align-items:flex-end;background:#fff;}',
    '#dy-widget-input{flex:1;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;outline:none;resize:none;font-family:inherit;line-height:1.5;max-height:96px;overflow-y:auto;color:#1e293b;}',
    '#dy-widget-input:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,0.12);}',
    '#dy-widget-input::placeholder{color:#94a3b8;}',
    '#dy-widget-send{background:#2563eb;color:#fff;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-size:16px;flex-shrink:0;height:40px;display:flex;align-items:center;justify-content:center;transition:background .12s;}',
    '#dy-widget-send:disabled{background:#93c5fd;cursor:not-allowed;}',
    '#dy-widget-send:hover:not(:disabled){background:#1d4ed8;}',
    '#dy-widget-stop{background:#ef4444;color:#fff;border:none;border-radius:10px;padding:0 12px;cursor:pointer;font-size:12px;font-weight:600;flex-shrink:0;height:40px;display:none;align-items:center;justify-content:center;gap:5px;transition:background .12s;}',
    '#dy-widget-stop:hover{background:#dc2626;}',

    '.dy-action-bar{display:flex;gap:2px;margin-top:6px;padding-top:4px;}',
    '.dy-action-btn{background:none;border:none;cursor:pointer;color:#94a3b8;width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:color .12s,background .12s;position:relative;}',
    '.dy-action-btn:hover{color:#475569;background:#e2e8f0;}',
    '.dy-action-btn.liked{color:#2563eb;}',
    '.dy-action-btn.disliked{color:#ef4444;}',
    '.dy-action-btn.copied{color:#16a34a;}',
    '.dy-reason-picker{position:absolute;bottom:calc(100% + 4px);left:0;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,0.12);display:flex;flex-direction:column;gap:3px;min-width:168px;z-index:100;}',
    '.dy-reason-btn{background:none;border:none;text-align:left;padding:7px 10px;border-radius:6px;cursor:pointer;font-size:12px;color:#374151;white-space:nowrap;}',
    '.dy-reason-btn:hover{background:#f1f5f9;color:#1d4ed8;}',
    '.dy-src-link{color:#2563eb;text-decoration:none;font-size:13px;display:inline-flex;align-items:center;gap:2px;}',
    '.dy-src-link:hover{text-decoration:underline;}',
    '.dy-web-link{color:#059669;text-decoration:none;font-size:13px;display:inline-flex;align-items:center;gap:2px;}',
    '.dy-web-link:hover{text-decoration:underline;}',
    '.dy-quick-wrap{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-self:flex-start;max-width:90%;}',
    '.dy-quick-btn{background:#fff;border:1px solid #cbd5e1;border-radius:16px;padding:5px 12px;font-size:12.5px;color:#334155;cursor:pointer;transition:background .12s,border-color .12s;white-space:nowrap;}',
    '.dy-quick-btn:hover{background:#eff6ff;border-color:#93c5fd;color:#1d4ed8;}',
  ].join('');
  document.head.appendChild(style);

  // ── 커스텀 색상 override ──────────────────────────────────────────────────
  function _dyRgb(hex) {
    hex = hex.replace('#', '');
    return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
  }
  var _c = _dyRgb(COLOR);
  var COLOR_DARK  = 'rgb('+Math.max(0,_c[0]-30)+','+Math.max(0,_c[1]-30)+','+Math.max(0,_c[2]-30)+')';
  var COLOR_ALPHA = 'rgba('+_c[0]+','+_c[1]+','+_c[2]+',0.12)';
  var colorStyle = document.createElement('style');
  colorStyle.textContent = [
    '#dy-widget-btn{background:'+COLOR+';}',
    '#dy-widget-btn:hover{background:'+COLOR_DARK+';}',
    '#dy-widget-header{background:'+COLOR+';}',
    '.dy-msg-user{background:'+COLOR+';}',
    '#dy-widget-input:focus{border-color:'+COLOR+';box-shadow:0 0 0 2px '+COLOR_ALPHA+';}',
    '#dy-widget-send{background:'+COLOR+';}',
    '#dy-widget-send:hover:not(:disabled){background:'+COLOR_DARK+';}',
    '.dy-action-btn.liked{color:'+COLOR+';}',
    '.dy-src-link{color:'+COLOR+';}',
    '.dy-quick-btn:hover{border-color:'+COLOR+';color:'+COLOR_DARK+';}',
  ].join('');
  document.head.appendChild(colorStyle);

  // ── 다크모드 CSS ──────────────────────────────────────────────────────────
  var darkStyle = document.createElement('style');
  darkStyle.textContent = [
    '#dy-widget-panel.dy-dark{background:#0f172a;}',
    '#dy-widget-panel.dy-dark #dy-widget-messages{background:#0f172a;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot{background:#1e293b;color:#e2e8f0;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot strong{color:#f1f5f9;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-h{color:#f1f5f9;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-h4{color:#93c5fd;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-h5,#dy-widget-panel.dy-dark .dy-msg-bot .dy-h6{color:#94a3b8;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-hr{border-top-color:#334155;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-code{background:#334155;color:#e2e8f0;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-src{color:#94a3b8;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-table th{background:#1e3a5f;color:#93c5fd;border-color:#2d4a7a;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-table td{border-color:#334155;}',
    '#dy-widget-panel.dy-dark .dy-msg-bot .dy-table tr:nth-child(even) td{background:#1a2744;}',
    '#dy-widget-panel.dy-dark .dy-thinking{background:#1e293b;}',
    '#dy-widget-panel.dy-dark #dy-widget-disclaimer{background:#0f172a;color:#475569;}',
    '#dy-widget-panel.dy-dark #dy-widget-footer{background:#0f172a;border-top-color:#1e293b;}',
    '#dy-widget-panel.dy-dark #dy-widget-input{background:#1e293b;color:#e2e8f0;border-color:#334155;}',
    '#dy-widget-panel.dy-dark #dy-widget-input::placeholder{color:#475569;}',
    '#dy-widget-panel.dy-dark .dy-action-btn:hover{background:#1e293b;}',
    '#dy-widget-panel.dy-dark .dy-reason-picker{background:#1e293b;border-color:#334155;}',
    '#dy-widget-panel.dy-dark .dy-reason-btn{color:#cbd5e1;}',
    '#dy-widget-panel.dy-dark .dy-reason-btn:hover{background:#0f172a;}',
    '#dy-widget-panel.dy-dark .dy-quick-btn{background:#1e293b;border-color:#334155;color:#94a3b8;}',
    '#dy-widget-panel.dy-dark .dy-quick-btn:hover{background:#162032;}',
  ].join('');
  document.head.appendChild(darkStyle);

  // ── DOM ───────────────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.id = 'dy-widget-btn';
  btn.title = TITLE + ' 열기';
  btn.innerHTML = SVG_CHAT;

  var panel = document.createElement('div');
  panel.id = 'dy-widget-panel';
  panel.innerHTML = [
    '<div id="dy-widget-header">',
    '  <div class="dy-title-area">',
    '    <div>' + TITLE + '</div>',
    '    <span>' + SUBTITLE + '</span>',
    '  </div>',
    '  <div class="dy-header-btns">',
    '    <button class="dy-hbtn" id="dy-btn-dark" title="다크모드">' + SVG_MOON + '</button>',
    '    <button class="dy-hbtn" id="dy-btn-site" title="전체 사이트 열기"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>',
    '    <button class="dy-hbtn" id="dy-btn-expand"   title="크게 보기"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>',
    '    <button class="dy-hbtn" id="dy-btn-maximize" title="최대화"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 3 3 3 3 9"/><polyline points="15 21 21 21 21 15"/></svg></button>',
    '    <button class="dy-hbtn" id="dy-widget-close" title="닫기"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>',
    '  </div>',
    '</div>',
    '<div id="dy-widget-messages"></div>',
    '<div id="dy-widget-disclaimer">AI 답변은 참고용이며, 중요한 사항은 HR 담당자에게 확인하세요.</div>',
    '<div id="dy-widget-footer">',
    '  <textarea id="dy-widget-input" rows="1" placeholder="질문을 입력하세요..."></textarea>',
    '  <button id="dy-widget-send" title="전송 (Enter)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
    '  <button id="dy-widget-stop" title="응답 중단"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="2"/></svg>중단</button>',
    '</div>',
  ].join('');

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var messagesEl  = document.getElementById('dy-widget-messages');
  var inputEl     = document.getElementById('dy-widget-input');
  var sendBtn     = document.getElementById('dy-widget-send');
  var stopBtn     = document.getElementById('dy-widget-stop');
  var expandBtn   = document.getElementById('dy-btn-expand');
  var maximizeBtn = document.getElementById('dy-btn-maximize');
  var siteBtn     = document.getElementById('dy-btn-site');
  var darkBtn     = document.getElementById('dy-btn-dark');

  siteBtn.addEventListener('click', function () {
    window.open(API_BASE + '/', '_blank', 'noopener');
  });

  // ── 다크모드 토글 ─────────────────────────────────────────────────────────
  function applyDark(dark) {
    isDark = dark;
    panel.classList.toggle('dy-dark', dark);
    darkBtn.innerHTML = dark ? SVG_SUN : SVG_MOON;
    darkBtn.title = dark ? '라이트모드' : '다크모드';
    try { localStorage.setItem('dy-widget-dark', dark ? '1' : '0'); } catch(e) {}
  }

  // 초기화: localStorage 저장값 → 시스템 설정 순으로 적용
  (function () {
    var stored = null;
    try { stored = localStorage.getItem('dy-widget-dark'); } catch(e) {}
    if (stored !== null) {
      applyDark(stored === '1');
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      applyDark(true);
    }
  })();

  darkBtn.addEventListener('click', function () { applyDark(!isDark); });

  // 시스템 다크모드 변경 감지 (사용자가 직접 토글하지 않은 경우에만)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      try { if (localStorage.getItem('dy-widget-dark') !== null) return; } catch(ex) {}
      applyDark(e.matches);
    });
  }

  stopBtn.addEventListener('click', function () {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
  });

  // ── 패널 크기 ─────────────────────────────────────────────────────────────
  function applySize(state) {
    var s = SIZES[state];
    panel.style.width        = s.width;
    panel.style.height       = s.height;
    panel.style.bottom       = s.bottom;
    panel.style.right        = s.right;
    panel.style.borderRadius = s.borderRadius;
    expandBtn.classList.toggle('active', state === 'expanded');
    maximizeBtn.classList.toggle('active', state === 'maximized');
    expandBtn.title   = state === 'expanded'   ? '기본 크기로' : '크게 보기';
    maximizeBtn.title = state === 'maximized' ? '기본 크기로' : '최대화';
    sizeState = state;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (_vvActive) _onViewportResize();
  }
  applySize('normal');

  // ── 모바일 키보드 대응 ────────────────────────────────────────────────────
  function _onViewportResize() {
    if (!isOpen) return;
    var vv = window.visualViewport;
    if (!vv) return;

    // 레이아웃 뷰포트 하단 기준으로 키보드가 차지하는 높이
    var offsetFromBottom = window.innerHeight - (vv.offsetTop + vv.height);

    if (offsetFromBottom > 50) {
      // 키보드 올라옴
      _vvActive = true;
      var availH = vv.height - 80;
      panel.style.height = Math.max(200, availH) + 'px';
      panel.style.bottom = (offsetFromBottom + 8) + 'px';
      btn.style.bottom   = (offsetFromBottom + 8) + 'px';
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } else if (_vvActive) {
      // 키보드 내려감 → 원래 크기 복원
      _vvActive = false;
      applySize(sizeState);
      btn.style.bottom = '24px';
    }
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', _onViewportResize);
  }

  // ── 토큰 발급 ─────────────────────────────────────────────────────────────
  function fetchToken() {
    return fetch(API_BASE + '/api/widget/token')
      .then(function (r) { return r.json(); })
      .then(function (d) { guestToken = d.token; })
      .catch(function () { guestToken = null; });
  }

  // ── 메시지 DOM 헬퍼 ───────────────────────────────────────────────────────
  function appendUserMsg(text) {
    var div = document.createElement('div');
    div.className = 'dy-msg dy-msg-user';
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  var QUICK_QUESTIONS = [
    '연차 사용 방법이 어떻게 되나요?',
    '육아휴직 조건이 어떻게 되나요?',
    '경조사 지원 기준이 어떻게 되나요?',
    '퇴직금 계산 기준은 무엇인가요?',
  ];

  function appendQuickButtons(questions) {
    var list = questions || QUICK_QUESTIONS;
    var wrap = document.createElement('div');
    wrap.className = 'dy-quick-wrap';
    wrap.id = 'dy-quick-wrap';
    list.forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'dy-quick-btn';
      b.textContent = q;
      b.addEventListener('click', function () {
        inputEl.value = q;
        sendMessage();
      });
      wrap.appendChild(b);
    });
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function fetchTopQuestions(callback) {
    fetch(API_BASE + '/api/widget/top-questions')
      .then(function (r) { return r.json(); })
      .then(function (data) { callback(data.questions || QUICK_QUESTIONS); })
      .catch(function () { callback(QUICK_QUESTIONS); });
  }

  function removeQuickButtons() {
    var wrap = document.getElementById('dy-quick-wrap');
    if (wrap) wrap.remove();
  }

  function appendThinking() {
    var div = document.createElement('div');
    div.className = 'dy-thinking';
    div.innerHTML = '<div class="dy-thinking-dots"><span></span><span></span><span></span></div><span>생각 중...</span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function appendBotMsg(html, streaming) {
    var div = document.createElement('div');
    div.className = 'dy-msg dy-msg-bot' + (streaming ? ' streaming' : '');
    div.innerHTML = html;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  var SVG_LIKE    = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';
  var SVG_DISLIKE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>';
  var SVG_REGEN   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
  var SVG_COPY    = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

  var DISLIKE_REASONS = ['정보가 부정확해요', '출처가 잘못됐어요', '질문과 관련 없어요', '답변이 불충분해요'];

  function appendActionBar(botEl, rawText, onRegenerate, question) {
    var bar = document.createElement('div');
    bar.className = 'dy-action-bar';
    var feedbackSent = false;

    function makeBtn(svg, title) {
      var b = document.createElement('button');
      b.className = 'dy-action-btn';
      b.title = title;
      b.innerHTML = svg;
      return b;
    }

    var likeBtn    = makeBtn(SVG_LIKE,    '도움이 됐어요');
    var dislikeBtn = makeBtn(SVG_DISLIKE, '도움이 안 됐어요');
    var regenBtn   = makeBtn(SVG_REGEN,   '다시 생성');
    var copyBtn    = makeBtn(SVG_COPY,    '복사');

    function sendFeedback(score, activeBtn, reason) {
      if (feedbackSent) return;
      feedbackSent = true;
      activeBtn.classList.add(score > 0 ? 'liked' : 'disliked');
      likeBtn.disabled = true;
      dislikeBtn.disabled = true;
      var msgId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      fetch(API_BASE + '/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: msgId,
          question: question || '',
          answer: rawText,
          score: score,
          comment: reason || null,
        }),
      }).catch(function () {
        feedbackSent = false;
        likeBtn.disabled = false;
        dislikeBtn.disabled = false;
        activeBtn.classList.remove(score > 0 ? 'liked' : 'disliked');
      });
    }

    likeBtn.addEventListener('click', function () { sendFeedback(1, likeBtn, null); });

    dislikeBtn.addEventListener('click', function () {
      if (feedbackSent) return;
      var existing = dislikeBtn.querySelector('.dy-reason-picker');
      if (existing) { existing.remove(); return; }

      var picker = document.createElement('div');
      picker.className = 'dy-reason-picker';
      DISLIKE_REASONS.forEach(function (reason) {
        var rb = document.createElement('button');
        rb.className = 'dy-reason-btn';
        rb.textContent = reason;
        rb.addEventListener('click', function (e) {
          e.stopPropagation();
          picker.remove();
          sendFeedback(-1, dislikeBtn, reason);
        });
        picker.appendChild(rb);
      });

      // 직접 입력
      var customWrap = document.createElement('div');
      customWrap.style.cssText = 'display:flex;gap:4px;padding:4px 4px 2px;border-top:1px solid #f1f5f9;margin-top:2px;';
      var customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.placeholder = '직접 입력...';
      customInput.style.cssText = 'flex:1;font-size:12px;padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;outline:none;color:#374151;min-width:0;';
      customInput.addEventListener('click', function (e) { e.stopPropagation(); });
      var customSubmit = document.createElement('button');
      customSubmit.textContent = '전송';
      customSubmit.style.cssText = 'background:#2563eb;color:#fff;border:none;border-radius:6px;padding:0 8px;font-size:12px;cursor:pointer;flex-shrink:0;';
      customSubmit.addEventListener('click', function (e) {
        e.stopPropagation();
        var val = customInput.value.trim();
        picker.remove();
        sendFeedback(-1, dislikeBtn, val || '기타');
      });
      customInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.stopPropagation(); customSubmit.click(); }
      });
      customWrap.appendChild(customInput);
      customWrap.appendChild(customSubmit);
      picker.appendChild(customWrap);

      dislikeBtn.appendChild(picker);
      setTimeout(function () { customInput.focus(); }, 50);

      function closeOnOutside(e) {
        if (!dislikeBtn.contains(e.target)) {
          picker.remove();
          document.removeEventListener('click', closeOnOutside);
        }
      }
      setTimeout(function () { document.addEventListener('click', closeOnOutside); }, 0);
    });

    regenBtn.addEventListener('click', function () { onRegenerate(); });

    copyBtn.addEventListener('click', function () {
      var plain = rawText
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/#{1,6} /g, '')
        .replace(/^\s*[-*]\s/gm, '• ');
      navigator.clipboard.writeText(plain).then(function () {
        copyBtn.classList.add('copied');
        setTimeout(function () { copyBtn.classList.remove('copied'); }, 1500);
      });
    });

    bar.appendChild(likeBtn);
    bar.appendChild(dislikeBtn);
    bar.appendChild(regenBtn);
    bar.appendChild(copyBtn);
    botEl.appendChild(bar);
  }

  // ── 메시지 전송 ───────────────────────────────────────────────────────────
  function sendMessage() {
    var query = inputEl.value.trim();
    if (!query || isLoading || !guestToken) return;

    isLoading = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
    inputEl.value = '';
    inputEl.style.height = 'auto';
    removeQuickButtons();

    var userEl  = appendUserMsg(query);
    var thinkingEl = appendThinking();
    var botEl  = null;
    var rawText = '';

    chatHistory.push({ role: 'user', content: query });

    function finishStream() {
      isLoading = false;
      stopBtn.style.display = 'none';
      sendBtn.style.display = 'flex';
      sendBtn.disabled = false;
      currentAbortController = null;
    }

    function doStream(retried) {
      currentAbortController = new AbortController();
      return fetch(API_BASE + '/api/widget/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + guestToken,
        },
        body: JSON.stringify({
          query: query,
          history: chatHistory.slice(-10),
          user_profile: '',
          mode: 'fast',
          web_search: webSearchEnabled,
        }),
        signal: currentAbortController.signal,
      }).then(function (response) {
        if (response.status === 401 && !retried) {
          return fetchToken().then(function () {
            if (!guestToken) throw new Error('auth_failed');
            return doStream(true);
          });
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        thinkingEl.remove();
        botEl = appendBotMsg('', true);

        var reader  = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer  = '';

        function read() {
          return reader.read().then(function (result) {
            if (result.done) {
              botEl.classList.remove('streaming');
              if (rawText.trim()) {
                chatHistory.push({ role: 'assistant', content: rawText });
                appendActionBar(botEl, rawText, function () {
                  if (isLoading) return;
                  userEl.remove();
                  botEl.remove();
                  if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'assistant') chatHistory.pop();
                  if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
                  inputEl.value = query;
                  sendMessage();
                }, query);
              }
              finishStream();
              return;
            }

            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split('\n');
            buffer = lines.pop();

            lines.forEach(function (line) {
              if (!line.startsWith('data: ')) return;
              var data = line.slice(6);
              if (data === '[DONE]')              return;
              if (data.startsWith('[THOUGHT]'))   return;
              if (data.startsWith('[TITLE]'))     return;

              rawText += data;
              botEl.innerHTML = renderMarkdown(rawText);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            });

            return read();
          });
        }
        return read();
      });
    }

    doStream(false).catch(function (err) {
      finishStream();
      if (err && err.name === 'AbortError') {
        // 사용자가 중단 — 부분 응답이 있으면 그대로 마무리
        if (thinkingEl.parentNode) thinkingEl.remove();
        if (botEl && rawText.trim()) {
          botEl.classList.remove('streaming');
          chatHistory.push({ role: 'assistant', content: rawText });
          appendActionBar(botEl, rawText, function () {
            if (isLoading) return;
            userEl.remove();
            botEl.remove();
            if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'assistant') chatHistory.pop();
            if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
            inputEl.value = query;
            sendMessage();
          }, query);
        } else {
          if (thinkingEl.parentNode) thinkingEl.remove();
          if (!botEl) chatHistory.pop();
        }
        return;
      }
      thinkingEl.remove();
      if (!botEl) appendBotMsg('⚠️ 서버 연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', false);
      chatHistory.pop();
    });
  }

  // ── 이벤트 바인딩 ─────────────────────────────────────────────────────────
  btn.addEventListener('click', function () {
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    btn.innerHTML = isOpen ? SVG_CLOSE : SVG_CHAT;
    if (isOpen && !guestToken) {
      fetchToken().then(function () {
        if (!guestToken) {
          appendBotMsg('⚠️ 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', false);
        } else if (messagesEl.children.length === 0) {
          appendBotMsg('안녕하세요! HR 규정에 대해 궁금한 점을 질문해 주세요.', false);
          fetchTopQuestions(function (qs) { appendQuickButtons(qs); });
        }
      });
    }
  });

  document.getElementById('dy-widget-close').addEventListener('click', function () {
    isOpen = false;
    panel.classList.remove('open');
    btn.innerHTML = SVG_CHAT;
    if (_vvActive) { _vvActive = false; applySize(sizeState); btn.style.bottom = '24px'; }
  });

  expandBtn.addEventListener('click', function () {
    applySize(sizeState === 'expanded' ? 'normal' : 'expanded');
  });

  maximizeBtn.addEventListener('click', function () {
    applySize(sizeState === 'maximized' ? 'normal' : 'maximized');
  });

  // ── 웹 검색 토글 버튼 ─────────────────────────────────────────────────────
  (function () {
    var webBtn = document.createElement('button');
    webBtn.type = 'button';
    webBtn.id   = 'dy-web-search-btn';
    webBtn.title = '웹 검색 ON/OFF (SearXNG)';
    webBtn.style.cssText = [
      'display:inline-flex; align-items:center; gap:4px;',
      'padding:3px 10px; border-radius:12px; border:1px solid #d1d5db;',
      'font-size:11px; font-weight:700; cursor:pointer; transition:all 0.2s;',
      'background:#f3f4f6; color:#6b7280; margin-right:4px;',
    ].join('');
    webBtn.innerHTML = '🌐 웹검색';

    webBtn.addEventListener('click', function () {
      webSearchEnabled = !webSearchEnabled;
      if (webSearchEnabled) {
        webBtn.style.background = '#10b981';
        webBtn.style.color      = '#ffffff';
        webBtn.style.border     = '1px solid #10b981';
      } else {
        webBtn.style.background = '#f3f4f6';
        webBtn.style.color      = '#6b7280';
        webBtn.style.border     = '1px solid #d1d5db';
      }
    });

    // 입력창 바로 위 footer 영역 앞에 삽입
    var footerEl = sendBtn.closest('.dy-footer') || sendBtn.parentNode;
    if (footerEl) footerEl.insertBefore(webBtn, footerEl.firstChild);
  })();

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 96) + 'px';
  });

})();
