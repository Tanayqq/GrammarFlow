'use strict';
/* Hands-free head pointer: turn your head to move a pointer, nod or rest on a control to click.
 * Input: earbud/tracker motion from helpers/head_bridge.py, which
 * relays OpenTrack data (e.g. GalaxyBudsClient for Galaxy Buds) as {yaw, pitch} on ws://127.0.0.1:18765.
 * Android-standard head-tracking earbuds are read directly through WebHID.
 * Only controls this page; browsers cannot move the system cursor. */
(function (root) {
  const DEG = 180 / Math.PI;

  /* ── Android head tracker HID protocol (source.android.com, "Head tracker HID protocol") ──
   * Earbuds implementing it expose a HID sensor (page 0x20, usage 0xE1) that WebHID can read. */
  const U = id => 0x200000 | id;
  const HT = { ROTATION: U(0x0544), ALL_EVENTS: U(0x0841), FULL_POWER: U(0x0851), INTERVAL: U(0x030E) };

  // Head-frame rotation vector (rad; X right ear, Y nose, Z up) -> yaw (left +) / pitch (up +).
  function rotvecToYawPitch([rx, ry, rz]) {
    const a = Math.hypot(rx, ry, rz);
    let f = [0, 1, 0];                         // nose direction, rotated with Rodrigues' formula
    if (a > 1e-9) {
      const k = [rx / a, ry / a, rz / a], c = Math.cos(a), s = Math.sin(a), d = k[1] * (1 - c);
      f = [k[0] * d - k[2] * s, c + k[1] * d, k[2] * d + k[0] * s];
    }
    return { yaw: Math.atan2(-f[0], f[1]) * DEG, pitch: Math.asin(Math.max(-1, Math.min(1, f[2]))) * DEG };
  }

  // Bit layout of one report from WebHID's parsed descriptor items.
  function layout(items) {
    let bit = 0;
    return items.map(item => { const at = bit; bit += item.reportSize * item.reportCount; return { item, at }; });
  }

  function readBits(bytes, at, size, signed) {
    let v = 0;
    for (let i = 0; i < size; i++) v += ((bytes[(at + i) >> 3] >> ((at + i) & 7)) & 1) * 2 ** i;
    return signed && v >= 2 ** (size - 1) ? v - 2 ** size : v;
  }

  // Finds the head tracker collection and the report ids/fields we need, or null.
  function findHeadTracker(collections) {
    const c = collections.find(col => col.usagePage === 0x20 && col.usage === 0xE1);
    const hasUsage = (r, u) => r.items.some(i => i.usages.includes(u) || (u >= i.usageMinimum && u <= i.usageMaximum));
    const input = c?.inputReports.find(r => hasUsage(r, HT.ROTATION));
    const control = c?.featureReports.find(r => hasUsage(r, HT.ALL_EVENTS));
    return input && control ? { input, control } : null;
  }

  // Feature report turning reporting on: All Events, Full Power, ~20 ms interval, defaults elsewhere.
  function encodeStart(control) {
    const fields = layout(control.items);
    const bytes = new Uint8Array(Math.ceil(fields.reduce((n, f) => n + f.item.reportSize * f.item.reportCount, 0) / 8));
    for (const { item, at } of fields) {
      let v = 0;
      const idx = [HT.ALL_EVENTS, HT.FULL_POWER].map(u => item.usages.indexOf(u)).find(i => i >= 0);
      if (idx !== undefined) v = item.logicalMinimum + idx;
      else if (item.usages.includes(HT.INTERVAL)) v = Math.min(item.logicalMaximum, 7); // 0..63 maps to 10..100 ms
      for (let i = 0; i < item.reportSize; i++) if ((v >> i) & 1) bytes[(at + i) >> 3] |= 1 << ((at + i) & 7);
    }
    return bytes;
  }

  // Input report -> rotation vector in radians, using the descriptor's physical scaling.
  function decodeRotation(input, bytes) {
    const { item, at } = layout(input.items).find(f => f.item.usages.includes(HT.ROTATION));
    const { logicalMinimum: lMin, logicalMaximum: lMax } = item;
    const noPhysical = !item.physicalMinimum && !item.physicalMaximum; // HID: fall back to logical range
    const pMin = noPhysical ? lMin : item.physicalMinimum, pMax = noPhysical ? lMax : item.physicalMaximum;
    const exp = item.unitExponent > 7 ? item.unitExponent - 16 : item.unitExponent; // 4-bit signed nibble
    return [0, 1, 2].map(i => {
      const v = readBits(bytes, at + i * item.reportSize, item.reportSize, lMin < 0);
      return (pMin + (v - lMin) * (pMax - pMin) / (lMax - lMin)) * 10 ** exp;
    });
  }

  // Relative mapping like AirCursor: the pointer follows how far the head turned since the
  // last applied pose, so there is nothing to calibrate and no drift. Jitter smaller than
  // `deadzone` degrees is ignored, but slow movement accumulates until it crosses it.
  function createPointer({ width, height, gain = 22, deadzone = 0.15 }) {
    let last = null;
    const p = { x: width / 2, y: height / 2 };
    p.resize = (w, h) => { width = w; height = h; p.x = Math.min(p.x, w); p.y = Math.min(p.y, h); };
    p.rebase = (yaw, pitch) => { last = { yaw, pitch }; }; // follow on from this pose without moving
    p.update = (yaw, pitch) => {
      if (!last) { last = { yaw, pitch }; return p; }
      const dYaw = ((yaw - last.yaw + 540) % 360) - 180; // safe across the ±180° wrap
      const dPitch = pitch - last.pitch;
      if (Math.abs(dYaw) < deadzone && Math.abs(dPitch) < deadzone) return p;
      p.x = Math.max(0, Math.min(width, p.x - dYaw * gain));
      p.y = Math.max(0, Math.min(height, p.y - dPitch * gain));
      last = { yaw, pitch };
      return p;
    };
    return p;
  }

  // One Euro filter (Casiez et al. 2012): strong smoothing when the head is nearly still,
  // light smoothing during fast moves, so sensor jitter disappears without adding lag.
  function createSmoother({ minCutoff = 0.5, beta = 0.05, dCutoff = 1 } = {}) {
    let x = null, dx = 0, lastT = 0;
    const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    return (value, t) => {
      if (x === null) { x = value; lastT = t; return x; }
      const dt = Math.max(1e-3, t - lastT); lastT = t;
      dx += alpha(dCutoff, dt) * ((value - x) / dt - dx);
      x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
      return x;
    };
  }

  // Dwell click: holding the pointer inside `radius` px for `ms` fires once.
  // A gap in samples (tracking lost) restarts unfinished progress, so untracked time never
  // counts; a completed click stays latched until the pointer leaves, so pauses never re-click.
  function createDwell({ radius = 28, ms = 1000, maxGap = 250 } = {}) {
    let anchor = null, fired = false, last = -Infinity;
    const step = (x, y, t, hold = false) => { // hold: the head isn't still, so a rest starts over
      if (t - last > maxGap) step.interrupt();
      last = t;
      if (!anchor || Math.hypot(x - anchor.x, y - anchor.y) > radius) { anchor = { x, y, t }; fired = false; }
      else if (hold && !fired) anchor = { x, y, t };
      const progress = Math.min(1, (t - anchor.t) / ms);
      const click = progress === 1 && !fired;
      if (click) fired = true;
      return { progress: fired && !click ? 0 : progress, click };
    };
    step.interrupt = () => { if (!fired) anchor = null; };
    step.latch = (x, y, t) => { anchor = { x, y, t }; fired = true; last = t; }; // clicked here another way: no second click
    return step;
  }

  // Nod click, ported from AirCursor's GestureDetector (github.com/m-afham/AirCursor, MIT).
  // A nod is a shape, not a speed: pitch leaves its start by >= `amplitude` degrees and comes
  // back most of the way within `window` ms, quickly, with little sideways turning. It returns
  // when the nod began so the click lands where you pointed before nodding. After a nod nothing
  // re-arms until the head settles, so one nod (and its follow-through) clicks once.
  function createNod({ amplitude = 5.5, window = 800, maxGap = 250 } = {}) {
    let history = [], awaitingStill = false, stillSince = null;
    const speed = (a, b, key) => (b.t > a.t ? Math.abs(b[key] - a[key]) / ((b.t - a.t) / 1000) : 0);
    const detect = now => {
      const last = history.length - 1, cur = history[last];
      for (let j = 0; j < last - 1; j++) {
        const start = history[j];
        if (now - start.t > window) continue;
        let extreme = 0, at = j;
        for (let k = j + 1; k < last; k++) {
          const d = history[k].pitch - start.pitch;
          if (Math.abs(d) > Math.abs(extreme)) { extreme = d; at = k; }
        }
        const depth = Math.abs(extreme);
        if (depth < amplitude || at === j) continue;
        if (Math.abs(cur.pitch - start.pitch) > depth * 0.35) continue;      // must come back 65% of the way
        const seg = history.slice(j), yaws = seg.map(p => p.yaw);
        if (Math.max(...yaws) - Math.min(...yaws) > Math.max(depth * 0.6, 3)) continue; // not a glance sideways
        let peak = 0;
        for (let k = 1; k < seg.length; k++) peak = Math.max(peak, speed(seg[k - 1], seg[k], 'pitch'));
        if (peak < 30) continue;                                              // slow = deliberate pointing
        // The dip's onset, not the oldest qualifying sample: the earliest fast step toward the
        // extreme (fast for this dip: 60% of its fastest outbound step, at most 40°/s), allowing a
        // pause of up to 2 samples on the way down. Slower aiming just before the nod is pointing,
        // so the click lands where it left the pointer.
        const dir = Math.sign(extreme);
        const out = k => ((history[k].pitch - history[k - 1].pitch) * dir) / ((history[k].t - history[k - 1].t) / 1000);
        let outPeak = 0;
        for (let k = j + 1; k <= at; k++) outPeak = Math.max(outPeak, out(k));
        const quick = Math.min(40, outPeak * 0.6), fast = k => out(k) >= quick; // the fastest outbound step always qualifies
        let onset = at;
        for (let k = at, pause = 0; k > j && pause <= 2; k--) {
          if (fast(k)) { onset = k - 1; pause = 0; } else pause++;
        }
        return history[onset].t;
      }
      return null;
    };
    const step = (yaw, pitch, t) => {
      const prev = history[history.length - 1];
      if (prev && (t - prev.t > maxGap || t <= prev.t)) { history = []; stillSince = null; } // stillness must be seen again
      // unwrap yaw so a turn across ±180° stays continuous
      const y = prev && history.length ? prev.yaw + (((yaw - prev.raw + 540) % 360) - 180) : yaw;
      history.push({ t, yaw: y, raw: yaw, pitch });
      history = history.filter(p => t - p.t <= 1500);
      if (awaitingStill) {
        const n = history.length;
        const s = n >= 2 ? Math.max(speed(history[n - 2], history[n - 1], 'pitch'), speed(history[n - 2], history[n - 1], 'yaw')) : 0;
        if (s >= 25) stillSince = null;
        else {
          if (stillSince === null) stillSince = t;
          if (t - stillSince >= 150) { awaitingStill = false; stillSince = null; history = history.slice(-1); }
        }
        return null;
      }
      const began = history.length >= 3 ? detect(t) : null;
      if (began !== null) { awaitingStill = true; stillSince = null; }
      return began;
    };
    step.settling = () => awaitingStill; // true from a nod until the head is still again
    return step;
  }

  // One head pose -> where the pointer is, dwell progress, and whether a nod clicked there.
  function createHeadCursor({ pointer, dwell, nod, radius = 28, overlap = 100 }) {
    let trail = [], rested = null, recent = []; // rested: where and when a rest last clicked
    return (yaw, pitch, t) => {
      const settling = nod.settling(), began = nod(yaw, pitch, t);
      // Still = the head stayed within 1° for the last 400 ms, so a pause inside a nod isn't
      // rest. Judged from the head, not the pointer, which can sit pinned at a screen edge.
      recent.push({ yaw, pitch, t });
      recent = recent.filter(p => t - p.t <= 400);
      const moving = recent.some(p => Math.max(Math.abs(((yaw - p.yaw + 540) % 360) - 180), Math.abs(pitch - p.pitch)) > 1);
      if (settling) pointer.rebase(yaw, pitch); // the nod's follow-through never moves the pointer
      let { x, y } = settling ? pointer : pointer.update(yaw, pitch);
      trail.push({ x, y, t });
      trail = trail.filter(p => t - p.t <= 1500);
      if (settling) return { x, y, progress: 0, click: false, nod: false };
      if (began !== null) { // a nod clicks where you pointed before the nod moved the pointer
        ({ x, y } = trail.find(p => p.t >= began) || { x, y });
        pointer.x = x; pointer.y = y;
        trail = [{ x, y, t }]; // the dip's positions are never a later nod's starting point
        dwell.latch(x, y, t);
        // A nod that began as a rest finished clicking the same spot is that same click;
        // a nod started later is a new one.
        const again = rested && began <= rested.t + overlap && Math.hypot(x - rested.x, y - rested.y) <= radius;
        return { x, y, progress: 0, click: false, nod: !again };
      }
      // A rest finishes only on a still sample, so the first jolt of a nod can't click first.
      const d = dwell(x, y, t, moving);
      if (d.click) rested = { x, y, t };
      return { x, y, ...d, nod: false };
    };
  }

  const core = { createSmoother, rotvecToYawPitch, findHeadTracker, encodeStart, decodeRotation, createPointer, createDwell, createNod, createHeadCursor };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ── Browser wiring ── */
  // The clickable area: unlike innerWidth/innerHeight, this leaves out scrollbars.
  const viewport = () => [document.documentElement.clientWidth, document.documentElement.clientHeight];
  const CLICKABLE = 'button, a[href], input, textarea, select, summary, [role="button"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

  // Browsers never let a page open a native dropdown list, so a hands-free click on one opens
  // this large on-screen list instead: point at an option and nod (or rest) to choose it.
  // The hands-free menu itself is skipped so a click can't turn hands-free off.
  let picker = null;
  function closePicker() { picker?.remove(); picker = null; }
  function openPicker(select) {
    closePicker();
    picker = document.createElement('div');
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', select.getAttribute('aria-label') || 'Choose an option');
    picker.style.cssText = 'position:fixed;inset:0;z-index:9997;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.45);padding:16px';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;color:#111;border-radius:14px;padding:12px;width:min(420px,100%);' +
      'max-height:80vh;overflow:auto;display:grid;gap:8px;box-shadow:0 10px 40px rgba(0,0,0,.3)';
    const choice = (label, onPick, current) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'min-height:56px;font:600 18px/1.2 system-ui,sans-serif;border-radius:10px;cursor:pointer;' +
        (current ? 'background:#2f5d45;color:#fff;border:2px solid #2f5d45' : 'background:#f3f5f1;color:#111;border:2px solid #d6dbd3');
      if (current) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', onPick);
      return b;
    };
    [...select.options].forEach((option, i) => {
      if (option.disabled) return;
      panel.append(choice(option.textContent.trim(), () => {
        select.selectedIndex = i;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closePicker();
      }, i === select.selectedIndex));
    });
    panel.append(choice('Cancel', closePicker, false));
    picker.append(panel);
    picker.addEventListener('keydown', e => { if (e.key === 'Escape') { closePicker(); select.focus(); } });
    document.body.append(picker);
    (panel.querySelector('[aria-current]') || panel.firstChild).focus();
  }

  function activate(target) {
    target.focus();
    if (target.tagName !== 'SELECT') { target.click(); return; }
    if (target.id === 'gf-head-src' || target.disabled || !target.options.length) return;
    openPicker(target);
  }
  let stopSource = null, pointer = null, dwell = null, head = null, cursor = null, reportStatus = () => {};

  // A source that breaks mid-session turns hands-free off and says so, instead of freezing.
  // Each menu choice gets an id; a source that finishes starting (or fails) after the user has
  // already chosen something else must not touch the current choice.
  let selection = 0;
  function failSource(message, id) {
    if (id !== selection) return;
    const menu = document.getElementById('gf-head-src');
    if (menu) menu.value = 'off';
    const report = reportStatus;
    setSource('off', report).then(() => report(message));
  }

  // t: when the sample was captured (before any inference), so dwell measures real tracking time.
  // Sources report through this, so one that was replaced while starting never moves the pointer.
  function emit(id, pose, t) { if (id === selection) onPose(pose, t); }

  function onPose({ yaw, pitch }, t = performance.now()) {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    const d = head(yaw, pitch, t);
    const target = document.elementFromPoint(d.x, d.y)?.closest(CLICKABLE);
    cursor.style.transform = `translate(${d.x}px, ${d.y}px)`;
    cursor.style.setProperty('--p', target ? d.progress : 0);
    if ((d.click || d.nod) && target) activate(target);
  }

  // Android-standard head tracker earbuds, read directly by Chrome/Edge through WebHID.
  // The latest HID start's cleanup and any close still in progress, so a newer start can reuse the device.
  let releaseHid = null, hidClosing = null, hidOpening = Promise.resolve();
  async function startHid(id) {
    if (!navigator.hid) throw new Error('This browser cannot read earbud sensors. Use Chrome or Edge.');
    const [device] = await navigator.hid.requestDevice({ filters: [{ usagePage: 0x20, usage: 0xE1 }] });
    if (!device) throw new Error('No head-tracking earbuds selected.');
    if (id !== selection) return () => {}; // an old picker resolved late: never touch the current session
    // Opening is queued: each start waits until the previous one has opened (or cleaned up) the device.
    const opened = hidOpening.then(async () => {
      await releaseHid?.(); // an earlier start may still hold the same device
      await hidClosing;     // ...or still be closing it
      if (id !== selection) return false;
      await device.open();
      if (id !== selection) { await device.close(); return false; } // chose something else while opening
      return true;
    });
    hidOpening = opened.catch(() => {});
    if (!(await opened)) return () => {};
    if (id !== selection) { // Off arrived just after opening: close through the queue, never enable sensors
      const closing = device.close().catch(() => {});
      hidOpening = hidOpening.then(() => closing);
      await closing;
      return () => {};
    }
    const tracker = findHeadTracker(device.collections);
    if (!tracker) { await device.close(); throw new Error('These earbuds do not share head tracking.'); }
    const onReport = e => {
      if (e.reportId === tracker.input.reportId) emit(id, rotvecToYawPitch(decodeRotation(tracker.input, new Uint8Array(e.data.buffer))));
    };
    const onDisconnect = e => { if (e.device === device) failSource('The earbuds disconnected. Choose them again to restart.', id); };
    let stopped = false;
    const stop = () => { // safe to call more than once
      if (stopped) return hidClosing;
      stopped = true;
      if (releaseHid === stop) releaseHid = null;
      navigator.hid.removeEventListener('disconnect', onDisconnect);
      device.removeEventListener('inputreport', onReport);
      const closing = hidClosing = device.close().catch(() => {}).finally(() => { if (hidClosing === closing) hidClosing = null; });
      return closing;
    };
    releaseHid = stop;
    stopSource = stop; // choosing Off while the start command is in flight must still stop it
    device.addEventListener('inputreport', onReport);
    navigator.hid.addEventListener('disconnect', onDisconnect);
    try {
      await device.sendFeatureReport(tracker.control.reportId, encodeStart(tracker.control));
    } catch (err) { // release the device, or the next attempt cannot open it
      await stop();
      throw err;
    }
    return stop;
  }

  function startEarbuds(id) {
    const ws = new WebSocket('ws://127.0.0.1:18765');
    stopSource = () => ws.close(); // choosing Off during the handshake cancels the connection
    ws.onmessage = e => { try { emit(id, JSON.parse(e.data)); } catch { /* ignore malformed frames */ } };
    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        // A deliberate switch closes this too, but by then its id is stale and failSource ignores it.
        ws.onclose = () => failSource('The head bridge stopped. Start helpers/head_bridge.py and choose it again.', id);
        resolve(() => ws.close());
      };
      ws.onerror = () => reject(new Error('Head bridge not running. Start helpers/head_bridge.py.'));
    });
  }

  async function setSource(name, status) {
    const id = ++selection;
    closePicker(); // never leave the option list open after hands-free changes
    reportStatus = status;
    if (stopSource) { stopSource(); stopSource = null; }
    cursor?.remove(); cursor = null;
    if (name === 'off') { status(''); return; }
    cursor = Object.assign(document.createElement('div'), { id: 'gf-head-cursor' });
    cursor.style.cssText = 'position:fixed;top:-14px;left:-14px;width:28px;height:28px;border-radius:50%;pointer-events:none;z-index:9999;' +
      'border:2px solid rgba(255,255,255,.9);box-shadow:0 0 0 2px rgba(0,0,0,.5);--p:0;' +
      'background:conic-gradient(rgba(168,85,247,.85) calc(var(--p) * 360deg), transparent 0)';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursor);
    pointer = createPointer({ width: viewport()[0] - 1, height: viewport()[1] - 1 });
    const gap = name === 'earbuds' ? { maxGap: 1000 } : {}; // OpenTrack senders can update slowly
    dwell = createDwell(gap);
    head = createHeadCursor({ pointer, dwell, nod: createNod(gap) });
    status('Starting…');
    try {
      const stop = await ({ hid: startHid, earbuds: startEarbuds })[name](id);
      if (id !== selection) { stop(); return; } // the user picked something else while this was starting
      stopSource = stop;
      status('Turn your head to point; nod or rest on a button to click.');
    } catch (err) {
      if (id !== selection) return; // a superseded start failed: nothing to report
      cursor?.remove(); cursor = null;
      status(err.message);
      throw err;
    }
  }

  addEventListener('resize', () => pointer?.resize(viewport()[0] - 1, viewport()[1] - 1));
  // Any page with a #gf-head-src menu (and optional #gf-head-status) gets hands-free mode.
  document.getElementById('gf-head-src')?.addEventListener('change', e => {
    const status = document.getElementById('gf-head-status');
    setSource(e.target.value, msg => { if (status) status.textContent = msg; }).catch(() => { e.target.value = 'off'; });
  });
  root.HeadPointer = { setSource, feed: p => cursor && onPose(p), core };
})(typeof window !== 'undefined' ? window : globalThis);
