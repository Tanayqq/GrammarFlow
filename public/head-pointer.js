'use strict';
/* Hands-free head pointer: turn your head to move a pointer, rest on a control to click.
 * Inputs: the webcam (hand: fingertip points and a pinch clicks) or earbud/tracker motion from helpers/head_bridge.py, which
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

  /* ── Hand mode: index fingertip points, a thumb–index pinch clicks ── */

  // Fingertip (MediaPipe normalized 0..1, camera view) -> screen pixels. The camera image is
  // mirrored so moving right moves right, and only the central area is used, so the edges of
  // the screen are reachable without reaching the edge of the camera view.
  function fingerToScreen(nx, ny, width, height, margin = 0.2) {
    const span = 1 - 2 * margin, clamp = v => Math.max(0, Math.min(1, v));
    return { x: clamp((1 - nx - margin) / span) * (width - 1), y: clamp((ny - margin) / span) * (height - 1) }; // last pixel is width - 1
  }

  // Thumb–index distance relative to hand size (wrist to middle knuckle), so it works near or
  // far from the camera. Landmarks: 0 wrist, 4 thumb tip, 8 index tip, 9 middle knuckle.
  // Uses MediaPipe's 3D hand points (`world`, metres) when given: in the flat camera image a palm
  // tilted towards the camera looks short, which made real pinches look wide open.
  function pinchRatio(hand, aspect = 4 / 3, world = null) {
    const d = world
      ? (a, b) => Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y, world[a].z - world[b].z)
      : (a, b) => Math.hypot((hand[a].x - hand[b].x) * aspect, hand[a].y - hand[b].y);
    return d(4, 8) / Math.max(1e-6, d(0, 9));
  }

  // Pinch with hysteresis: `click` fires once when the fingers close, and not again until they
  // open past `open`. `hold` is true while closing, so the pointer can freeze and the click lands
  // where you were pointing, not where the pinch pulled the fingertip.
  function createPinch({ close = 0.42, open = 0.6, hold = 0.5 } = {}) {
    let down = false;
    return ratio => {
      const click = !down && ratio < close;
      if (click) down = true;
      else if (down && ratio > open) down = false;
      return { click, hold: down || ratio < hold };
    };
  }

  // Gesture state that must survive tracker restarts (tracking loss, camera stalls): the pinch,
  // where the pointer froze, and the last position. Only the smoothing starts fresh.
  const createGesture = () => ({ pinch: createPinch(), held: null, previous: null });

  // One hand frame -> { x, y, click } in screen pixels, or null when no hand is in view.
  function createHandTracker(gesture = createGesture()) {
    // Tuned for pixels: steady when the finger rests, little trailing when it moves.
    const sx = createSmoother({ minCutoff: 1.5, beta: 0.05 }), sy = createSmoother({ minCutoff: 1.5, beta: 0.05 });
    return (hand, t, width, height, aspect = 4 / 3, world = null) => {
      if (!hand) return null;
      const tip = fingerToScreen(hand[8].x, hand[8].y, width, height);
      const at = { x: sx(tip.x, t), y: sy(tip.y, t), t };
      const ratio = pinchRatio(hand, aspect, world), p = gesture.pinch(ratio);
      // Freeze at the spot from just before the fingers started closing (if that was recent), so
      // the click lands where you were pointing, not where the pinch pulled the fingertip.
      const recent = gesture.previous && t - gesture.previous.t < 0.5 ? gesture.previous : null;
      if (!p.hold) gesture.held = null;
      else if (!gesture.held) gesture.held = recent || at;
      gesture.previous = at;
      const { x, y } = gesture.held || at;
      return { x, y, click: p.click, hold: p.hold, ratio };
    };
  }

  const core = { createGesture, createHandTracker, fingerToScreen, pinchRatio, createPinch, createSmoother, rotvecToYawPitch, findHeadTracker, encodeStart, decodeRotation, createPointer, createDwell };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ── Browser wiring ── */
  // The clickable area: unlike innerWidth/innerHeight, this leaves out scrollbars.
  const viewport = () => [document.documentElement.clientWidth, document.documentElement.clientHeight];
  const CLICKABLE = 'button, a[href], input, textarea, select, summary, [role="button"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

  // Browsers never let a page open a native dropdown list, so a hands-free click on one opens
  // this large on-screen list instead: point at an option and pinch (or rest) to choose it.
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
    if (d.click && target) activate(target);
  }

  // Diagnostics for tuning, shown under the camera preview only when the address has ?debug.
  const DEBUG = new URLSearchParams(location.search).has('debug');
  const diag = { device: '-', fps: 0, ms: 0, pinch: null, last: '-' };
  const describe = el => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` : 'nothing';

  // Hand mode: the pointer follows the fingertip directly, and a pinch clicks (no resting needed).
  let clickFlashUntil = 0;
  function onPoint({ x, y, click }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (click) clickFlashUntil = performance.now() + 300; // the ring fills briefly so every pinch is visible
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    cursor.style.setProperty('--p', performance.now() < clickFlashUntil ? 1 : 0);
    const target = click && document.elementFromPoint(x, y)?.closest(CLICKABLE);
    if (click) diag.last = describe(target);
    if (target) activate(target);
  }

  // What each camera mode tracks. `frame` returns false when nothing is in view.
  const CAMERA_MODES = {
    hand: {
      label: 'Hand (webcam)',
      ready: 'Point with your index finger; pinch thumb and finger to click.',
      missing: 'Show your hand to the camera.',
      model: async (vision, files) => {
        const options = delegate => ({
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', delegate },
          runningMode: 'VIDEO', numHands: 1,
          // A fast-moving finger is a blurry finger: at the 0.5 defaults one blurred frame drops the
          // hand and the model has to search the whole image again. Keep following it instead.
          minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3
        });
        // The graphics chip is usually much faster; fall back to the processor where it is unavailable.
        try { const m = await vision.HandLandmarker.createFromOptions(files, options('GPU')); diag.device = 'GPU'; return m; }
        catch { diag.device = 'CPU'; return vision.HandLandmarker.createFromOptions(files, options('CPU')); }
      },
      start(session) {
        session.gesture ||= createGesture(); // survives restarts: a held pinch is never a new click
        const track = createHandTracker(session.gesture);
        return (result, ms, id, video, preview) => {
          const hand = result.landmarks?.[0];
          const point = track(hand, ms / 1000, ...viewport(), (video.videoWidth || 4) / (video.videoHeight || 3), result.worldLandmarks?.[0]);
          preview.mark(hand?.[8], point);
          diag.pinch = point ? point.ratio : null;
          if (!point) return false;
          emitPoint(id, point);
          return true;
        };
      }
    }
  };

  // Sources report through this, so one replaced while starting never moves the pointer.
  function emitPoint(id, point) { if (id === selection) onPoint(point); }

  async function startCamera(id, kind) {
    const mode = CAMERA_MODES[kind];
    const again = `Choose ${mode.label} again to restart.`;
    // Per-frame callbacks (Chrome, Edge, Safari 15.4+, Firefox 132+) guarantee one inference per real camera frame.
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) throw new Error('Update your browser to use webcam mode.');
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    const landmarker = await mode.model(vision, files);
    if (id !== selection) { landmarker.close(); return () => {}; } // chose something else while the model loaded
    let stream, video, released = false, readout = null;
    // A small mirrored preview, so you can see whether your hand or face is in view. It also puts the
    // video on the page, which some browsers need before they deliver camera frames. Stays on-device.
    const preview = document.createElement('div'), dot = document.createElement('div');
    preview.setAttribute('aria-hidden', 'true');
    preview.style.cssText = 'position:fixed;right:16px;bottom:16px;width:min(192px,30vw);aspect-ratio:4/3;border-radius:10px;overflow:hidden;' +
      'z-index:9998;pointer-events:none;background:#000;box-shadow:0 2px 12px rgba(0,0,0,.35)';
    dot.style.cssText = 'position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;' +
      'background:#a855f7;border:2px solid #fff;display:none';
    let dotFlashUntil = 0;
    preview.mark = (tip, point) => { // fingertip in camera coordinates, drawn mirrored like the video
      dot.style.display = tip ? 'block' : 'none';
      if (!tip) return;
      dot.style.left = `${(1 - tip.x) * 100}%`;
      dot.style.top = `${tip.y * 100}%`;
      if (point?.click) dotFlashUntil = performance.now() + 400;
      // purple: pointing; amber: fingers closing; green: click registered
      dot.style.background = performance.now() < dotFlashUntil ? '#22c55e' : point?.hold ? '#f59e0b' : '#a855f7';
    };
    const release = () => { // safe to call more than once
      if (released) return;
      released = true;
      preview.remove();
      stream?.getTracks().forEach(t => t.stop());
      landmarker.close();
    };
    stopSource = release; // choosing Off during the permission prompt or playback start must free everything
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: { ideal: 60 } } }); // shorter frames blur less, where the camera can
      if (id !== selection) { stream.getTracks().forEach(t => t.stop()); release(); return () => {}; } // late stream after Off
      video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true, playsInline: true });
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1)';
      preview.append(video, dot);
      if (DEBUG) {
        readout = document.createElement('div');
        readout.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:3px 6px;font:11px/1.35 ui-monospace,monospace;' +
          'color:#fff;background:rgba(0,0,0,.65);white-space:pre';
        preview.append(readout);
        preview.style.width = 'min(260px,60vw)'; // room for the numbers
      }
      document.body.appendChild(preview);
      // Match the camera's real shape (often 16:9), so nothing is cropped and the dot lines up.
      // 'resize' fires once the size is known, and again if the camera changes it.
      video.addEventListener('resize', () => {
        if (video.videoWidth && video.videoHeight) preview.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      });
      await video.play();
    } catch (err) { // release what was acquired before the failure
      release();
      throw err;
    }
    if (id !== selection) { release(); return () => {}; }
    let handle = 0, track = null, tracking = false, lastMs = -Infinity, shown = mode.ready;
    const frameTimes = [];
    const hint = text => { if (text !== shown && id === selection) { shown = text; reportStatus(text); } };
    const session = {}; // state a mode keeps across tracking restarts
    const lose = () => { // nothing in view, or the camera stalled: an unfinished rest must start over
      tracking = false;
      dwell.interrupt();
      cursor?.style.setProperty('--p', 0);
    };
    const loop = (now, frame) => { // once per delivered camera frame
      handle = video.requestVideoFrameCallback(loop); // ask for the next frame first, so one bad frame cannot end the loop
      try {
        // Capture time where given, else this callback's clock; never let it go backwards (MediaPipe rejects that).
        const ms = Math.max(frame.captureTime ?? now, lastMs + 1);
        if (ms - lastMs > 250 && tracking) lose(); // camera stalled: next sample is a fresh start, not a jump
        lastMs = ms;
        const started = performance.now();
        const result = landmarker.detectForVideo(video, ms);
        if (readout) {
          diag.ms = diag.ms * 0.9 + (performance.now() - started) * 0.1;
          frameTimes.push(started);
          while (frameTimes[0] < started - 1000) frameTimes.shift();
          readout.textContent = `${frameTimes.length} fps · model ${diag.ms.toFixed(0)} ms (${diag.device})\n` +
            `pinch ${diag.pinch == null ? '-' : diag.pinch.toFixed(2)} (clicks below 0.42)\nlast click: ${diag.last}`;
        }
        if (!tracking) track = mode.start(session); // fresh filters and baseline after any loss
        if (track(result, ms, id, video, preview)) { tracking = true; hint(mode.ready); }
        else { if (tracking && cursor) lose(); hint(mode.missing); }
      } catch {
        failSource(`Webcam tracking stopped. ${again}`, id);
      }
    };
    handle = video.requestVideoFrameCallback(loop);
    // An unplugged camera just stops delivering frames, so watch the track itself.
    const [videoTrack] = stream.getVideoTracks();
    const onEnded = () => failSource(`The camera was disconnected. ${again}`, id);
    const onMute = () => { if (id === selection) lose(); }; // camera stalled without disconnecting
    videoTrack.addEventListener('ended', onEnded);
    videoTrack.addEventListener('mute', onMute);
    return () => {
      videoTrack.removeEventListener('ended', onEnded);
      videoTrack.removeEventListener('mute', onMute);
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
    dwell = createDwell(name === 'earbuds' ? { maxGap: 1000 } : {}); // OpenTrack senders can update slowly
    status('Starting…');
    try {
      const stop = await ({ hand: id => startCamera(id, 'hand'), hid: startHid, earbuds: startEarbuds })[name](id);
      if (id !== selection) { stop(); return; } // the user picked something else while this was starting
      stopSource = stop;
      status(name === 'hand' ? CAMERA_MODES.hand.ready : 'Turn your head to point; rest on a button to click.');
    } catch (err) {
      if (id !== selection) return; // a superseded start failed: nothing to report
      cursor?.remove(); cursor = null;
      status(err.name === 'NotAllowedError' ? 'Camera permission was denied.' : err.message);
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
