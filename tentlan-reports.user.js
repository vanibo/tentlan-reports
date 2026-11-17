// ==UserScript==
// @name         Тентлан – доклади за племето
// @namespace    tentlan-tribe-reports
// @version      1.0.1
// @description  Бутон „Сподели“ в докладите от битка и шпионаж: текст за чата/форума и линк без реклами.
// @match        *://*.tentlan.com/*
// @match        *://tentlan.com/*
// @downloadURL  https://vanibo.github.io/tentlan-reports/tentlan-reports.user.js
// @updateURL    https://vanibo.github.io/tentlan-reports/tentlan-reports.user.js
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const VIEWER_URL = 'https://vanibo.github.io/tentlan-reports/';

  // Общо ядро: четене на доклада от страницата, изчистване, текст, кодиране в линк.
// Вгражда се и в userscript-а, и в страницата за преглед (build.py).
const TR = (() => {
  const RES = {
    Limestone: 'Варовик', Obsidian: 'Обсидиан', Cacao: 'Какао',
    Corn: 'Царевица', Population: 'Население', Gold: 'Злато',
  };
  const KEEP = new Set(['DIV', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
    'B', 'STRONG', 'I', 'EM', 'BR', 'P', 'SMALL', 'UL', 'LI']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'INS', 'IMG', 'BUTTON', 'INPUT',
    'SELECT', 'TEXTAREA', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'LINK',
    'META', 'NOSCRIPT', 'FORM', 'TEMPLATE']);
  const MAX_BYTES = 400000;

  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const cls = el => el.getAttribute && (el.getAttribute('class') || '') || '';
  const cleanClass = c => c.split(/\s+/).filter(x => /^[A-Za-z][\w-]{0,40}$/.test(x)).join(' ');

  // Пресъздава HTML само с разрешени тагове и атрибути (class, title, width %).
  function sanitize(node) {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += esc(n.nodeValue.replace(/\s+/g, ' ')); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      const c = cls(n);
      if (/google-auto-placed|adsbygoogle|trx-/.test(c)) continue;
      if (tag === 'BR') { out += '<br>'; continue; }
      const inner = sanitize(n);
      if (!KEEP.has(tag)) { out += inner; continue; }
      const t = tag.toLowerCase();
      let a = '';
      const cc = cleanClass(c); if (cc) a += ` class="${cc}"`;
      const title = n.getAttribute('title'); if (title) a += ` title="${esc(norm(title).slice(0, 80))}"`;
      const w = (n.getAttribute('style') || '').match(/(?:^|;)\s*width:\s*(\d{1,3}(?:\.\d+)?)%/);
      if (w) a += ` style="width:${Math.min(100, parseFloat(w[1]))}%"`;
      out += `<${t}${a}>${inner}</${t}>`;
    }
    return out.replace(/> +</g, '> <');
  }

  function upTo(el, sel) {
    for (let p = el.parentElement, i = 0; p && i < 8; p = p.parentElement, i++) {
      if (p.querySelector(sel)) return p;
    }
    return null;
  }

  // Намира всички доклади на страницата: [{kind:'s'|'c', root, anchor}]
  function findReports(doc) {
    const out = [];
    doc.querySelectorAll('.spyReportTitle').forEach(a => {
      const r = upTo(a, '.spyReportInfoContents'); if (r) out.push({ kind: 's', root: r, anchor: a });
    });
    doc.querySelectorAll('.reportTitle').forEach(a => {
      const r = upTo(a, '.reportTroops, .reportResults'); if (r) out.push({ kind: 'c', root: r, anchor: a });
    });
    return out;
  }

  function reportName(rep) {
    for (const t of rep.root.querySelectorAll('.ribbonSectionTitle .windowTitle2a')) {
      if (t.compareDocumentPosition(rep.anchor) & Node.DOCUMENT_POSITION_FOLLOWING) return norm(t.textContent);
      break;
    }
    return rep.kind === 's' ? 'Доклад от шпионажа' : 'Доклад от битката';
  }

  function capture(rep, server) {
    return { v: 1, k: rep.kind, s: server || '', t: Date.now(), n: reportName(rep), h: sanitize(rep.root) };
  }

  // ---------- текст ----------
  function resName(el) {
    if (!el.classList || !el.classList.contains('resourceIconSmall')) return null;
    for (const c of el.classList) if (c in RES || /^[A-Z]/.test(c)) return RES[c] || c;
    return null;
  }
  function txt(el) {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1) {
        const r = resName(n);
        if (r) s += (/\d\s*$/.test(s) ? ' |' : '') + ` ${r}: `;
        else if (n.tagName === 'BR') s += ' ';
        else s += ' ' + txt(n) + ' ';
      }
    }
    return norm(s);
  }
  const first = (root, sel) => { const e = root.querySelector(sel); return e ? txt(e) : ''; };
  const nextSib = (el, sel) => { for (let s = el.nextElementSibling; s; s = s.nextElementSibling) if (s.matches(sel)) return s; return null; };
  const ribbonBefore = el => {
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
      if (s.matches('.ribbonSectionTitleContainer')) return first(s, '.windowTitle2a');
      if (s.textContent.trim()) return '';
    }
    return '';
  };
  const stamp = t => {
    const d = new Date(t), p = x => String(x).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  function spyText(root, L) {
    L.push(first(root, '.spyReportTitleHero'));
    const date = first(root, '.spyReportTitleDate'); if (date) L.push(date);
    root.querySelectorAll('.spyReportSectionTitle').forEach(h => {
      const head = txt(h);
      const body = nextSib(h, '.spyReportSectionContent'); if (!body) return;
      const res = body.querySelectorAll('.spyReportResourcesBlock > div');
      const entries = body.querySelectorAll('.spyReportColumnEntry');
      L.push('');
      if (res.length) {
        L.push(`${head}:`); res.forEach(d => L.push('  ' + txt(d)));
      } else if (entries.length) {
        const items = [...entries].map(e => {
          const lbl = e.querySelector('.spyReportLabel'), amtEl = e.querySelector('.spyReportAmountLabel');
          const amt = amtEl ? txt(amtEl).replace(/^\((.*)\)$/, '$1') : '';
          let name = lbl ? lbl.cloneNode(true) : e.cloneNode(true);
          name.querySelectorAll('.spyReportAmountLabel').forEach(x => x.remove());
          return (txt(name) + ' ' + amt).trim();
        });
        if (body.closest('.units') || h.closest('.units')) { L.push(`${head}:`); items.forEach(i => L.push('  ' + i)); }
        else L.push(`${head}: ${items.join(', ')}`);
      } else {
        L.push(`${head}: ${txt(body)}`);
      }
    });
  }

  function combatText(root, L) {
    const parties = [...root.querySelectorAll('.reportTitleHero > *')].map(txt).filter(Boolean);
    if (parties.length) L.push(parties.join(' '));
    const sub = first(root, '.reportTitleSubHero'); if (sub) L.push(sub);
    const sum = [first(root, '.reportSummaryHero'), first(root, '.reportSummarySubHero')].filter(Boolean).join(' ');
    if (sum) L.push(sum);

    const troops = root.querySelector('.reportTroops');
    if (troops) {
      L.push('', `== ${ribbonBefore(troops) || 'Войски'} ==`);
      troops.querySelectorAll('.reportTroopsColumn').forEach(col => {
        col.querySelectorAll('.reportTroopContainer').forEach(tc => {
          const who = [first(tc, '.reportUserInfoName'), first(tc, '.reportUserInfoGuild')].filter(Boolean).join(' ');
          const mods = [...tc.querySelectorAll('.reportUserModifier')]
            .map(m => (m.getAttribute('title') ? m.getAttribute('title') + ' ' : '') + txt(m)).join(', ');
          L.push('', `-- ${who || '?'}${mods ? ' (' + mods + ')' : ''} --`);
          tc.querySelectorAll('.reportColumnEntry').forEach(e => {
            L.push(`  ${first(e, '.reportEntryLabel')} ${first(e, '.reportEntryValue')}`.trimEnd());
          });
        });
        const foot = [...col.querySelectorAll('.reportTroopsColumnFoot > *')].map(txt).filter(Boolean);
        if (foot.length) L.push('  ' + foot.join(' | '));
      });
    }

    const rounds = root.querySelector('.reportRounds');
    if (rounds) {
      L.push('', `== ${ribbonBefore(rounds) || 'Рундове'} ==`);
      const th = [...rounds.querySelectorAll('thead th')].map(txt);
      rounds.querySelectorAll('tbody tr').forEach(tr => {
        const td = [...tr.children].map(txt);
        L.push(`  ${td[0]}: ` + td.slice(1).map((v, i) => (th[i + 1] ? th[i + 1] + ' ' : '') + v).join(' | '));
      });
    }

    const results = root.querySelector('.reportResults');
    if (results) {
      L.push('', `== ${ribbonBefore(results) || 'Резултати'} ==`);
      results.querySelectorAll('.reportResultsBlock > *').forEach(d => { const t = txt(d); if (t) L.push(t); });
    }
  }

  // root: елемент с доклада (в играта или в страницата за преглед)
  function toText(root, kind, meta) {
    const L = [`=== ${meta.n || ''}${meta.s ? ' (' + meta.s + ')' : ''} ===`];
    if (kind === 's') spyText(root, L);
    else if (kind === 'c') combatText(root, L);
    else L.push(txt(root));
    L.push('', `Споделен на ${stamp(meta.t || Date.now())}`);
    return L.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // ---------- кодиране за линка ----------
  async function encode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function decode(code) {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) throw new Error('Докладът е твърде голям');
      parts.push(value);
    }
    const all = new Uint8Array(total); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    const obj = JSON.parse(new TextDecoder().decode(all));
    if (!obj || obj.v !== 1 || typeof obj.h !== 'string') throw new Error('Непознат формат');
    return obj;
  }

  return { sanitize, findReports, capture, toText, encode, decode, norm };
})();


  const server = () => location.hostname.split('.')[0];

  const css = `
  .trx-wrap{margin-top:5px}
  .trx-btn{position:relative;z-index:50;font:bold 12px Verdana,sans-serif;color:#fff3d6;
    background:linear-gradient(#a0582c,#6b2f14);border:1px solid #4a1f0b;border-radius:6px;padding:4px 9px;cursor:pointer;
    box-shadow:0 1px 2px rgba(0,0,0,.3)}
  .trx-btn:hover{filter:brightness(1.15)}
  .trx-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center}
  .trx-box{background:#fbf3dc;color:#3b2a1a;border:2px solid #a0582c;border-radius:10px;width:min(640px,94vw);
    max-height:90vh;display:flex;flex-direction:column;font:13px Verdana,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)}
  .trx-head{background:linear-gradient(#8a4421,#6b2f14);color:#fff3d6;padding:8px 12px;font-weight:bold;
    display:flex;justify-content:space-between;align-items:center;border-radius:8px 8px 0 0}
  .trx-x{background:none;border:0;color:#fff3d6;font-size:18px;cursor:pointer}
  .trx-body{padding:10px 12px;overflow:auto}
  .trx-body textarea{width:100%;height:260px;font:12px Consolas,monospace;resize:vertical;box-sizing:border-box;
    border:1px solid #d8c79e;background:#fff;color:#222}
  .trx-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
  .trx-row button{font:13px Verdana,sans-serif;border:1px solid #5a2610;background:#fff3d6;color:#5a2610;border-radius:6px;
    padding:5px 10px;cursor:pointer}
  .trx-row button:hover{background:#ffe2a8}
  .trx-row button:disabled{opacity:.5;cursor:default}
  .trx-note{color:#7d6a52;font-size:11px}`;

  function addStyle() {
    if (document.getElementById('trx-style')) return;
    const s = document.createElement('style'); s.id = 'trx-style'; s.textContent = css;
    (document.head || document.documentElement).append(s);
  }

  async function copy(text) {
    if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return; }
    try { await navigator.clipboard.writeText(text); }
    catch {
      const a = document.createElement('textarea'); a.value = text; document.body.append(a); a.select();
      document.execCommand('copy'); a.remove();
    }
  }

  function flash(btn, msg) {
    const old = btn.textContent; btn.textContent = msg; setTimeout(() => (btn.textContent = old), 1300);
  }

  async function openPanel(rep) {
    const data = TR.capture(rep, server());
    const text = TR.toText(rep.root, rep.kind, data);

    const ov = document.createElement('div'); ov.className = 'trx-ov';
    ov.innerHTML = `<div class="trx-box">
      <div class="trx-head"><span></span><button class="trx-x" title="Затвори">✕</button></div>
      <div class="trx-body">
        <textarea readonly></textarea>
        <div class="trx-row">
          <button data-a="text">Копирай текста</button>
          <button data-a="link" disabled>Копирай линка</button>
          <button data-a="open" disabled>Отвори линка</button>
          <span class="trx-note">Подготвям линка…</span>
        </div>
      </div></div>`;
    ov.querySelector('.trx-head span').textContent = data.n;
    ov.querySelector('textarea').value = text;
    const stop = e => e.stopPropagation();
    ['click', 'mousedown', 'mouseup', 'keydown', 'wheel'].forEach(ev => ov.addEventListener(ev, stop));
    const close = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.trx-x').onclick = close;
    document.body.append(ov);

    let link = '';
    const note = ov.querySelector('.trx-note');
    ov.querySelector('[data-a="text"]').onclick = async e => { await copy(text); flash(e.target, 'Копирано ✓'); };
    ov.querySelector('[data-a="link"]').onclick = async e => { await copy(link); flash(e.target, 'Копирано ✓'); };
    ov.querySelector('[data-a="open"]').onclick = () => window.open(link, '_blank', 'noopener');
    try {
      link = VIEWER_URL + '#' + await TR.encode(data);
      ov.querySelectorAll('button[disabled]').forEach(b => (b.disabled = false));
      note.textContent = `Дължина на линка: ${link.length} знака`;
    } catch (err) {
      note.textContent = 'Линкът не може да се създаде в този браузър. Текстът работи.';
    }
  }

  function addButtons() {
    for (const rep of TR.findReports(document)) {
      if (rep.anchor.dataset.trxDone) continue;
      rep.anchor.dataset.trxDone = '1';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'trx-btn'; b.textContent = 'Сподели';
      b.title = 'Сподели доклада в племето (без реклами)';
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPanel(rep); });
      // под датата на доклада (шпионаж) или под мястото на битката
      const spot = rep.anchor.querySelector('.spyReportTitleRight') || rep.anchor;
      const wrap = document.createElement('div');
      wrap.className = 'trx-wrap';
      wrap.append(b);
      spot.append(wrap);
    }
  }

  // Играта променя страницата постоянно (таймери), затова проверяваме на интервал,
  // а не „когато страницата спре да се променя“.
  const safeAdd = () => { try { addButtons(); } catch (e) { console.warn('[Тентлан доклади]', e); } };
  addStyle();
  safeAdd();
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; safeAdd(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(safeAdd, 1500);
})();
