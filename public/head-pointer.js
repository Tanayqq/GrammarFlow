'use strict';
/* Hands-free head pointer: turn your head to move a pointer, rest on a control to click.
 * Inputs: the webcam (any laptop) or earbud/tracker motion from helpers/head_bridge.py, which
 * relays OpenTrack data (e.g. GalaxyBudsClient for Galaxy Buds) as {yaw, pitch} on ws://127.0.0.1:18765.
 * Only controls this page; browsers cannot move the system cursor. */
(function (root) {
  const DEG = 180 / Math.PI;

  // 4x4 column-major face transform (MediaPipe) -> yaw/pitch in degrees.
  function matrixToYawPitch(m) {
    return { yaw: Math.atan2(m[8], m[10]) * DEG, pitch: Math.asin(Math.max(-1, Math.min(1, -m[9]))) * DEG };
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

  const core = { matrixToYawPitch, createPointer, createDwell };
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
      stopSource = await (name === 'webcam' ? startWebcam() : startEarbuds());
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
