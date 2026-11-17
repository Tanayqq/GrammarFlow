'use strict';
/* Hands-free head pointer: turn your head to move a pointer, rest on a control to click.
 * Inputs: the webcam (any laptop) or earbud/tracker motion from helpers/head_bridge.py, which
 * relays OpenTrack data (e.g. GalaxyBudsClient for Galaxy Buds) as {yaw, pitch} on ws://127.0.0.1:18765.
 * Android-standard head-tracking earbuds are read directly through WebHID.
 * Only controls this page; browsers cannot move the system cursor. */
(function (root) {
  const DEG = 180 / Math.PI;

  // 4x4 column-major face transform (MediaPipe) -> yaw/pitch in degrees.
  function matrixToYawPitch(m) {
    return { yaw: Math.atan2(m[8], m[10]) * DEG, pitch: Math.asin(Math.max(-1, Math.min(1, -m[9]))) * DEG };
  }

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

  // Dwell click: holding the pointer inside `radius` px for `ms` fires once.
  function createDwell({ radius = 28, ms = 1000 } = {}) {
    let anchor = null, fired = false;
    return (x, y, t) => {
      if (!anchor || Math.hypot(x - anchor.x, y - anchor.y) > radius) { anchor = { x, y, t }; fired = false; }
      const progress = Math.min(1, (t - anchor.t) / ms);
      const click = progress === 1 && !fired;
      if (click) fired = true;
      return { progress: fired && !click ? 0 : progress, click };
    };
  }

  const core = { matrixToYawPitch, rotvecToYawPitch, findHeadTracker, encodeStart, decodeRotation, createPointer, createDwell };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ── Browser wiring ── */
  const CLICKABLE = 'button, a[href], input, textarea, select, summary, [role="button"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  let stopSource = null, pointer = null, dwell = null, cursor = null;

  function onPose({ yaw, pitch }) {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    const { x, y } = pointer.update(yaw, pitch);
    const target = document.elementFromPoint(x, y)?.closest(CLICKABLE);
    const d = dwell(x, y, performance.now());
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    cursor.style.setProperty('--p', target ? d.progress : 0);
    if (d.click && target) { target.focus(); target.click(); }
  }

  async function startWebcam() {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    const landmarker = await vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
      runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true
    });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true, playsInline: true });
    await video.play();
    let raf = 0;
    const loop = () => {
      const m = landmarker.detectForVideo(video, performance.now()).facialTransformationMatrixes?.[0]?.data;
      if (m) { const pose = matrixToYawPitch(m); onPose({ yaw: -pose.yaw, pitch: pose.pitch }); } // mirror: turn right -> pointer right
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); landmarker.close(); };
  }

  // Android-standard head tracker earbuds, read directly by Chrome/Edge through WebHID.
  async function startHid() {
    if (!navigator.hid) throw new Error('This browser cannot read earbud sensors. Use Chrome or Edge.');
    const [device] = await navigator.hid.requestDevice({ filters: [{ usagePage: 0x20, usage: 0xE1 }] });
    if (!device) throw new Error('No head-tracking earbuds selected.');
    await device.open();
    const tracker = findHeadTracker(device.collections);
    if (!tracker) { await device.close(); throw new Error('These earbuds do not share head tracking.'); }
    const onReport = e => {
      if (e.reportId === tracker.input.reportId) onPose(rotvecToYawPitch(decodeRotation(tracker.input, new Uint8Array(e.data.buffer))));
    };
    device.addEventListener('inputreport', onReport);
    await device.sendFeatureReport(tracker.control.reportId, encodeStart(tracker.control));
    return () => { device.removeEventListener('inputreport', onReport); device.close(); };
  }

  function startEarbuds() {
    const ws = new WebSocket('ws://127.0.0.1:18765');
    ws.onmessage = e => { try { onPose(JSON.parse(e.data)); } catch { /* ignore malformed frames */ } };
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(() => ws.close());
      ws.onerror = () => reject(new Error('Head bridge not running. Start helpers/head_bridge.py.'));
    });
  }

  async function setSource(name, status) {
    if (stopSource) { stopSource(); stopSource = null; }
    cursor?.remove(); cursor = null;
    if (name === 'off') { status(''); return; }
    cursor = Object.assign(document.createElement('div'), { id: 'gf-head-cursor' });
    cursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursor);
    pointer = createPointer({ width: innerWidth, height: innerHeight });
    dwell = createDwell();
    status('Starting…');
    try {
      stopSource = await ({ webcam: startWebcam, hid: startHid, earbuds: startEarbuds })[name]();
      status('Turn your head to point; rest on a button to click.');
    } catch (err) {
      cursor?.remove(); cursor = null;
      status(err.name === 'NotAllowedError' ? 'Camera permission was denied.' : err.message);
      throw err;
    }
  }

  addEventListener('resize', () => pointer?.resize(innerWidth, innerHeight));
  root.HeadPointer = { setSource, feed: p => cursor && onPose(p), core };
})(typeof window !== 'undefined' ? window : globalThis);
