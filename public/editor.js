'use strict';

/* ── API connector (uses same relative path as main app.js) ── */
const API = {
  async call(endpoint, body) {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const base = isLocal ? 'http://localhost:3000/api/v1' : '/api/v1';
    const r = await fetch(base + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error?.message || 'Server error');
    return d;
  }
};

/* ── Auto-Save ── */
const Save = {
  KEY: 'gf_flow_v1',
  timer: null,
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.write(), 30000);
    document.getElementById('gf-save-dot').classList.add('unsaved');
  },
  write() {
    const data = {
      paragraphs: Editor.getParagraphTexts(),
      activeIdx: Editor.activeIdx,
      strips: StripMgr.strips,
      ts: Date.now()
    };
    localStorage.setItem(this.KEY, JSON.stringify(data));
    const dot = document.getElementById('gf-save-dot');
    dot.classList.remove('unsaved');
    dot.title = 'Saved ' + new Date().toLocaleTimeString();
  },
  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; }
  }
};

/* ── Context Strip Manager ── */
const StripMgr = {
  strips: [],
  zone: null,

  init() { this.zone = document.getElementById('gf-strips'); },

  compress(paragraphs) {
    const text = paragraphs.join('\n\n');
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    this.strips.push({ preview, full: text, paragraphs: [...paragraphs] });
    this.render();
  },

  render() {
    this.zone.innerHTML = '';
    this.strips.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'context-strip';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.innerHTML = `
        <span class="strip-num">§${i + 1}</span>
        <span class="strip-preview">${esc(s.preview)}…</span>
        <span class="strip-icon">▶</span>
        <div class="strip-content">${esc(s.full)}</div>`;
      el.addEventListener('click', () => this.toggle(el));
      this.zone.appendChild(el);
    });
  },

  toggle(el) {
    const wasOpen = el.classList.contains('expanded');
    this.zone.querySelectorAll('.context-strip').forEach(s => s.classList.remove('expanded'));
    if (!wasOpen) el.classList.add('expanded');
  },

  collapseAll() {
    this.zone.querySelectorAll('.context-strip').forEach(s => s.classList.remove('expanded'));
  },

  stripsHeight() {
    return this.zone ? this.zone.getBoundingClientRect().height : 0;
  }
};

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Session Timer ── */
const Timer = {
  start: Date.now(),
  init() {
    setInterval(() => {
      const s = Math.floor((Date.now() - this.start) / 1000);
      const m = Math.floor(s / 60), sec = s % 60;
      document.getElementById('gf-timer').textContent = m + ':' + String(sec).padStart(2, '0');
    }, 1000);
  }
};

function updateWordCount() {
  const total = Editor.getParagraphTexts().join(' ').split(/\s+/).filter(Boolean).length;
  document.getElementById('gf-words').textContent = total + ' words';
}

/* ── Main Editor ── */
const Editor = {
  canvas: null,
  activeIdx: 0,
  paras: [],
  hudTimer: null,
  COMPRESS_AT: 8,

  init() {
    this.canvas = document.getElementById('gf-canvas');
    StripMgr.init();

    const saved = Save.load();
    if (saved && saved.paragraphs && saved.paragraphs.length) {
      if (saved.strips) StripMgr.strips = saved.strips;
      StripMgr.render();
      saved.paragraphs.forEach((t, i) => this.addPara(t, i === saved.paragraphs.length - 1));
    } else {
      this.addPara('', true);
    }

    Timer.init();
    this.centerActive();
    this.bindPanelClose();
  },

  addPara(text, focus) {
    const wrap = document.createElement('div');
    wrap.className = 'gf-para new-para' + (focus ? ' active' : ' dimmed');
    if (!text) wrap.classList.add('empty');

    const ta = document.createElement('textarea');
    ta.className = 'gf-para-inner';
    ta.value = text;
    ta.rows = 1;
    ta.setAttribute('data-placeholder', 'Begin writing…');
    ta.setAttribute('spellcheck', 'true');
    ta.setAttribute('autocomplete', 'off');
    ta.setAttribute('aria-label', 'Paragraph ' + (this.paras.length + 1));

    wrap.appendChild(ta);
    this.canvas.appendChild(wrap);
    this.paras.push(wrap);
    const idx = this.paras.length - 1;

    this.autoResize(ta);
    ta.addEventListener('input', () => this.onInput(idx, ta, wrap));
    ta.addEventListener('focus', () => this.setActive(idx));
    ta.addEventListener('keydown', e => this.onKeyDown(e, idx, ta));

    if (focus) {
      requestAnimationFrame(() => { ta.focus(); this.setActive(idx); });
    }
    return wrap;
  },

  autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  },

  setActive(idx) {
    this.activeIdx = idx;
    this.paras.forEach((p, i) => {
      p.classList.toggle('active', i === idx);
      p.classList.toggle('dimmed', i !== idx);
    });
    this.centerActive();
    StripMgr.collapseAll();
  },

  centerActive() {
    const active = this.paras[this.activeIdx];
    if (!active) return;
    const ta = active.querySelector('textarea');
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const stripsH = StripMgr.stripsHeight();
    const usableH = window.innerHeight - stripsH - 60;
    const targetTop = stripsH + usableH / 2;
    const currentMid = rect.top + rect.height / 2;
    const delta = targetTop - currentMid;
    const current = parseFloat(this.canvas.style.marginTop) || 0;
    this.canvas.style.transition = 'margin-top 350ms cubic-bezier(.16,1,.3,1)';
    this.canvas.style.marginTop = (current + delta) + 'px';
  },

  onInput(idx, ta, wrap) {
    this.autoResize(ta);
    wrap.classList.toggle('empty', ta.value.trim() === '');
    updateWordCount();
    this.showHud();
    Save.schedule();
    if (this.paras.length >= this.COMPRESS_AT && idx === this.paras.length - 1) {
      this.maybeCompress();
    }
  },

  maybeCompress() {
    const keepLast = 3;
    if (this.paras.length < this.COMPRESS_AT) return;
    const toCompress = this.paras.slice(0, this.paras.length - keepLast);
    if (!toCompress.length) return;
    const texts = toCompress.map(p => p.querySelector('textarea').value);
    StripMgr.compress(texts);
    toCompress.forEach(p => this.canvas.removeChild(p));
    this.paras = this.paras.slice(this.paras.length - keepLast);
    this.activeIdx = this.paras.length - 1;
    this.paras.forEach((p, i) => {
      p.classList.toggle('active', i === this.activeIdx);
      p.classList.toggle('dimmed', i !== this.activeIdx);
    });
    this.canvas.classList.add('page-turning');
    setTimeout(() => this.canvas.classList.remove('page-turning'), 500);
  },

  onKeyDown(e, idx, ta) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.addPara('', true);
      this.setActive(this.paras.length - 1);
      Save.schedule();
      return;
    }
    if (e.key === 'Backspace' && ta.value === '' && this.paras.length > 1) {
      e.preventDefault();
      this.canvas.removeChild(this.paras[idx]);
      this.paras.splice(idx, 1);
      const newIdx = Math.max(0, idx - 1);
      this.setActive(newIdx);
      const prevTa = this.paras[newIdx].querySelector('textarea');
      prevTa.focus();
      prevTa.selectionStart = prevTa.selectionEnd = prevTa.value.length;
      return;
    }
    if (e.key === 'ArrowUp' && idx > 0 && ta.selectionStart === 0) {
      e.preventDefault();
      this.paras[idx - 1].querySelector('textarea').focus();
    }
    if (e.key === 'ArrowDown' && idx < this.paras.length - 1 && ta.selectionStart === ta.value.length) {
      e.preventDefault();
      this.paras[idx + 1].querySelector('textarea').focus();
    }
    // Esc closes edit panel if open
    if (e.key === 'Escape') ModeCtrl.closeEdit();
  },

  getParagraphTexts() {
    const fromStrips = StripMgr.strips.flatMap(s => s.paragraphs);
    const current = this.paras.map(p => p.querySelector('textarea').value);
    return [...fromStrips, ...current];
  },

  getActiveParagraphText() {
    return this.paras[this.activeIdx]?.querySelector('textarea')?.value || '';
  },

  getFullText() { return this.getParagraphTexts().join('\n\n'); },

  replaceActiveParagraph(text) {
    const ta = this.paras[this.activeIdx]?.querySelector('textarea');
    if (!ta) return;
    ta.value = text;
    this.autoResize(ta);
    ta.dispatchEvent(new Event('input'));
  },

  showHud() {
    const bar = document.getElementById('gf-status');
    bar.classList.remove('fade');
    clearTimeout(this.hudTimer);
    this.hudTimer = setTimeout(() => bar.classList.add('fade'), 2200);
  },

  bindPanelClose() {
    document.getElementById('gf-close-panel').addEventListener('click', () => ModeCtrl.closeEdit());
  }
};

/* ── Edit/Flow Mode Controller ── */
const ModeCtrl = {
  mode: 'flow',

  openEdit() {
    this.mode = 'edit';
    document.getElementById('gf-panel').classList.add('open');
    document.getElementById('gf-panel').setAttribute('aria-hidden', 'false');
    document.getElementById('gf-body').classList.add('edit-open');
    document.getElementById('gf-mode-badge').textContent = 'EDIT';
    document.getElementById('gf-mode-badge').classList.add('edit-mode');
    Editor.centerActive();
  },

  closeEdit() {
    this.mode = 'flow';
    document.getElementById('gf-panel').classList.remove('open');
    document.getElementById('gf-panel').setAttribute('aria-hidden', 'true');
    document.getElementById('gf-body').classList.remove('edit-open');
    document.getElementById('gf-mode-badge').textContent = 'FLOW';
    document.getElementById('gf-mode-badge').classList.remove('edit-mode');
    Editor.paras[Editor.activeIdx]?.querySelector('textarea')?.focus();
    Editor.centerActive();
  }
};

/* ── AI Helpers ── */
const AIui = {
  show(label) {
    document.getElementById('gf-ai-label').textContent = label;
    document.getElementById('gf-ai-overlay').classList.remove('hidden');
    document.getElementById('gf-ai-dot').style.display = 'inline';
  },
  hide() {
    document.getElementById('gf-ai-overlay').classList.add('hidden');
    document.getElementById('gf-ai-dot').style.display = 'none';
  },
  set(id, html) { document.getElementById(id).innerHTML = html; }
};

/* ── Edit Mode Button ── */
// Opens the Edit panel (users click the FLOW badge or use the edit button in the panel)
document.getElementById('gf-mode-badge').style.cursor = 'pointer';
document.getElementById('gf-mode-badge').title = 'Click to toggle Edit Mode';
document.getElementById('gf-mode-badge').addEventListener('click', () => {
  ModeCtrl.mode === 'flow' ? ModeCtrl.openEdit() : ModeCtrl.closeEdit();
});

/* ── Grammar Fix ── */
document.getElementById('gf-run-grammar').addEventListener('click', async () => {
  const text = Editor.getFullText();
  if (!text.trim()) return;
  const btn = document.getElementById('gf-run-grammar');
  btn.disabled = true;
  AIui.show('Fixing grammar…');
  try {
    const lang = document.getElementById('gf-lang').value;
    const res = await API.call('/grammar-fix', { text, language: lang, humanize: true });
    const fixed = typeof res.data === 'string' ? res.data : (res.data?.[0] || '');
    AIui.set('gf-grammar-out', `<div style="white-space:pre-wrap">${esc(fixed)}</div>`);
    document.getElementById('gf-grammar-actions').classList.remove('hidden');
    document.getElementById('gf-apply-grammar').dataset.fixed = fixed;
  } catch (e) {
    AIui.set('gf-grammar-out', `<span style="color:#f87171">Error: ${e.message}</span>`);
  } finally { AIui.hide(); btn.disabled = false; }
});

document.getElementById('gf-apply-grammar').addEventListener('click', () => {
  const fixed = document.getElementById('gf-apply-grammar').dataset.fixed;
  if (!fixed) return;
  const newParas = fixed.split(/\n\n+/).filter(s => s.trim());
  Editor.canvas.innerHTML = '';
  Editor.paras = [];
  newParas.forEach((t, i) => Editor.addPara(t, i === newParas.length - 1));
  Editor.setActive(Editor.paras.length - 1);
  document.getElementById('gf-grammar-actions').classList.add('hidden');
  Save.write();
});

document.getElementById('gf-reject-grammar').addEventListener('click', () => {
  document.getElementById('gf-grammar-actions').classList.add('hidden');
  AIui.set('gf-grammar-out', '<p class="placeholder-text">Fix grammar errors in your current draft.</p>');
});

/* ── Smart Suggestions ── */
document.getElementById('gf-run-suggest').addEventListener('click', async () => {
  const text = Editor.getFullText();
  if (!text.trim()) return;
  const btn = document.getElementById('gf-run-suggest');
  btn.disabled = true;
  AIui.show('Analyzing…');
  try {
    const lang = document.getElementById('gf-lang').value;
    const res = await API.call('/analyze-smart', {
      text, language: lang, humanize: true,
      writingContext: { intent: 'neutral', wordCount: text.split(/\s+/).length }
    });
    const items = Array.isArray(res.data) ? res.data : [];
    if (!items.length) {
      AIui.set('gf-suggest-out', '<p class="placeholder-text">No suggestions — your writing looks great!</p>');
    } else {
      AIui.set('gf-suggest-out',
        items.map(s => `<div class="suggestion-item">
          <div class="sug-cat">${esc(s.category || 'Suggestion')}</div>
          <div class="sug-text">${esc(s.suggestion || s.reason || '')}</div>
        </div>`).join(''));
    }
  } catch (e) {
    AIui.set('gf-suggest-out', `<span style="color:#f87171">Error: ${e.message}</span>`);
  } finally { AIui.hide(); btn.disabled = false; }
});

/* ── Rewrite ── */
document.getElementById('gf-run-rewrite').addEventListener('click', async () => {
  const text = Editor.getActiveParagraphText() || Editor.getFullText();
  if (!text.trim()) return;
  const btn = document.getElementById('gf-run-rewrite');
  btn.disabled = true;
  AIui.show('Rewriting…');
  try {
    const style = document.getElementById('gf-style').value;
    const lang  = document.getElementById('gf-lang').value;
    const res = await API.call('/rewrite', { text, style, tone: 'Friendly', language: lang, humanize: true });
    const rewrites = Array.isArray(res.data) ? res.data : [res.data];
    AIui.set('gf-rewrite-out',
      rewrites.filter(Boolean).map((r, i) =>
        `<div class="rewrite-item" data-rw="${esc(r)}" tabindex="0" title="Click to apply">
          <div class="rw-num">Option ${i + 1}</div>
          <div>${esc(r)}</div>
        </div>`
      ).join(''));
    document.querySelectorAll('.rewrite-item').forEach(el => {
      el.addEventListener('click', () => {
        Editor.replaceActiveParagraph(el.dataset.rw);
        Save.schedule();
      });
    });
  } catch (e) {
    AIui.set('gf-rewrite-out', `<span style="color:#f87171">Error: ${e.message}</span>`);
  } finally { AIui.hide(); btn.disabled = false; }
});

/* ── Export ── */
document.getElementById('gf-export-txt').addEventListener('click', () => {
  const blob = new Blob([Editor.getFullText()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grammarflow_draft.txt';
  a.click();
});

document.getElementById('gf-export-md').addEventListener('click', () => {
  const md = Editor.getParagraphTexts().map(p => p.trim()).join('\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grammarflow_draft.md';
  a.click();
});

document.getElementById('gf-copy-all').addEventListener('click', async () => {
  await navigator.clipboard.writeText(Editor.getFullText());
  const btn = document.getElementById('gf-copy-all');
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy All'; }, 1500);
});

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => Editor.init());
