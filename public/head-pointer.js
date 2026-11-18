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
    p.rebase = () => { last = null; }; // after tracking loss: next pose is a new baseline, no jump
    return p;
  }

  // One Euro filter (Casiez et al. 2012): strong smoothing when the head is nearly still,
  // light smoothing during fast moves, so webcam jitter disappears without adding lag.
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

  // Keeps yaw continuous across ±180° so smoothing never sees a 358° jump.
  function createUnwrap() {
    let out = null, last = 0;
    return raw => { out = out === null ? raw : out + ((raw - last + 540) % 360) - 180; last = raw; return out; };
  }

  // Dwell click: holding the pointer inside `radius` px for `ms` fires once.
  // A gap in samples (tracking lost) restarts unfinished progress, so untracked time never
  // counts; a completed click stays latched until the pointer leaves, so pauses never re-click.
  function createDwell({ radius = 28, ms = 1000, maxGap = 250 } = {}) {
    let anchor = null, fired = false, last = -Infinity;
    const step = (x, y, t) => {
      if (t - last > maxGap) step.interrupt();
      last = t;
      if (!anchor || Math.hypot(x - anchor.x, y - anchor.y) > radius) { anchor = { x, y, t }; fired = false; }
      const progress = Math.min(1, (t - anchor.t) / ms);
      const click = progress === 1 && !fired;
      if (click) fired = true;
      return { progress: fired && !click ? 0 : progress, click };
    };
    step.interrupt = () => { if (!fired) anchor = null; };
    return step;
  }

  const core = { createSmoother, createUnwrap, matrixToYawPitch, rotvecToYawPitch, findHeadTracker, encodeStart, decodeRotation, createPointer, createDwell };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ── Browser wiring ── */
  const CLICKABLE = 'button, a[href], input, textarea, select, summary, [role="button"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  let stopSource = null, pointer = null, dwell = null, cursor = null, reportStatus = () => {};

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
    const { x, y } = pointer.update(yaw, pitch);
    const target = document.elementFromPoint(x, y)?.closest(CLICKABLE);
    const d = dwell(x, y, t);
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    cursor.style.setProperty('--p', target ? d.progress : 0);
    if (d.click && target) { target.focus(); target.click(); }
  }

  async function startWebcam(id) {
    // Per-frame callbacks (Chrome, Edge, Safari 15.4+, Firefox 132+) guarantee one inference per real camera frame.
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) throw new Error('Update your browser to use webcam mode.');
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    const landmarker = await vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
      runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true
    });
    if (id !== selection) { landmarker.close(); return () => {}; } // chose something else while the model loaded
    let stream, video, released = false;
    const release = () => { // safe to call more than once
      if (released) return;
      released = true;
      stream?.getTracks().forEach(t => t.stop());
      landmarker.close();
    };
    stopSource = release; // choosing Off during the permission prompt or playback start must free everything
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      if (id !== selection) { stream.getTracks().forEach(t => t.stop()); release(); return () => {}; } // late stream after Off
      video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true, playsInline: true });
      await video.play();
    } catch (err) { // release what was acquired before the failure
      release();
      throw err;
    }
    if (id !== selection) { release(); return () => {}; }
    let handle = 0;
    let smoothYaw, smoothPitch, unwrapYaw, tracking = false, lastMs = -Infinity;
    const loop = (now, frame) => { // once per delivered camera frame
      handle = video.requestVideoFrameCallback(loop); // ask for the next frame first, so one bad frame cannot end the loop
      try {
        // Capture time where given, else this callback's clock; never let it go backwards (MediaPipe rejects that).
        const ms = Math.max(frame.captureTime ?? now, lastMs + 1);
        if (ms - lastMs > 250 && tracking) { // camera stalled: next pose is a fresh start, not a jump
          tracking = false;
          dwell.interrupt();
          cursor?.style.setProperty('--p', 0);
        }
        lastMs = ms;
        const m = landmarker.detectForVideo(video, ms).facialTransformationMatrixes?.[0]?.data;
        if (m) {
          if (!tracking) { smoothYaw = createSmoother(); smoothPitch = createSmoother(); unwrapYaw = createUnwrap(); pointer.rebase(); tracking = true; }
          const pose = matrixToYawPitch(m), t = ms / 1000;
          emit(id, { yaw: -smoothYaw(unwrapYaw(pose.yaw), t), pitch: smoothPitch(pose.pitch, t) }, ms); // mirror: turn right -> pointer right
        } else if (tracking && cursor) { // no face: tracking is lost, an unfinished rest must start over
          tracking = false;
          dwell.interrupt();
          cursor.style.setProperty('--p', 0);
        }
      } catch {
        failSource('Webcam tracking stopped. Choose Head (webcam) again to restart.', id);
      }
    };
    handle = video.requestVideoFrameCallback(loop);
    // An unplugged camera just stops delivering frames, so watch the track itself.
    const [track] = stream.getVideoTracks();
    const onEnded = () => failSource('The camera was disconnected. Choose Head (webcam) again to restart.', id);
    const onMute = () => { // camera stalled without disconnecting: no half-filled ring while nothing can move
      if (id !== selection) return;
      tracking = false; // next frame re-baselines instead of jumping
      dwell.interrupt();
      cursor?.style.setProperty('--p', 0);
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    return () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
      video.cancelVideoFrameCallback(handle);
      release();
    };
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
    pointer = createPointer({ width: innerWidth, height: innerHeight });
    dwell = createDwell(name === 'earbuds' ? { maxGap: 1000 } : {}); // OpenTrack senders can update slowly
    status('Starting…');
    try {
      const stop = await ({ webcam: startWebcam, hid: startHid, earbuds: startEarbuds })[name](id);
      if (id !== selection) { stop(); return; } // the user picked something else while this was starting
      stopSource = stop;
      status('Turn your head to point; rest on a button to click.');
    } catch (err) {
      if (id !== selection) return; // a superseded start failed: nothing to report
      cursor?.remove(); cursor = null;
      status(err.name === 'NotAllowedError' ? 'Camera permission was denied.' : err.message);
      throw err;
    }
  }

  addEventListener('resize', () => pointer?.resize(innerWidth, innerHeight));
  // Any page with a #gf-head-src menu (and optional #gf-head-status) gets hands-free mode.
  document.getElementById('gf-head-src')?.addEventListener('change', e => {
    const status = document.getElementById('gf-head-status');
    setSource(e.target.value, msg => { if (status) status.textContent = msg; }).catch(() => { e.target.value = 'off'; });
  });
  root.HeadPointer = { setSource, feed: p => cursor && onPose(p), core };
})(typeof window !== 'undefined' ? window : globalThis);
