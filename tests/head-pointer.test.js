const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matrixToYawPitch, createPointer, createDwell } = require('../public/head-pointer.js');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('face matrix decodes yaw/pitch', () => {
    const a = 30 * Math.PI / 180; // 30° yaw about y, column-major
    const m = matrixToYawPitch([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
    close(m.yaw, 30); close(m.pitch, 0);
});

test('pointer follows head movement, ignores jitter, clamps and survives the 180° wrap', () => {
    const p = createPointer({ width: 1000, height: 800, gain: 10, deadzone: 0.2 });
    p.update(0, 0);
    p.update(-5, 0);                       // turn right 5°
    assert.equal(p.x, 550);
    p.update(-5.1, 0.1);                   // jitter below the dead zone
    assert.deepEqual([p.x, p.y], [550, 400]);
    p.update(-5.1, -100);                  // big look down clamps to the edge
    assert.equal(p.y, 800);
    const slow = createPointer({ width: 1000, height: 800, gain: 10, deadzone: 0.2 });
    slow.update(0, 0);
    for (let i = 1; i <= 10; i++) slow.update(0, i * 0.1);  // 1° look up in 0.1° frames
    assert.ok(slow.y <= 392, `slow movement lost: y=${slow.y}`); // at most one dead zone left over
    const w = createPointer({ width: 1000, height: 800, gain: 10 });
    w.update(179, 0); w.update(-179, 0);   // +2° across the wrap, not -358°
    assert.equal(w.x, 480);
});

test('dwell clicks once after holding still, and restarts after moving away', () => {
    const dwell = createDwell({ radius: 10, ms: 1000, maxGap: Infinity }); // sparse samples on purpose
    assert.equal(dwell(100, 100, 0).click, false);
    assert.equal(dwell(105, 100, 500).progress, 0.5);
    assert.equal(dwell(103, 101, 1000).click, true);
    assert.equal(dwell(103, 101, 1500).click, false);     // no repeat while still resting
    dwell(300, 300, 1600);                                 // moved away: new anchor
    assert.equal(dwell(300, 300, 2600).click, true);
});

test('webcam smoothing removes still-head jitter so rest-to-click works, without lagging real moves', () => {
    const { createSmoother } = require('../public/head-pointer.js');
    let seed = 7;
    const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2; }; // ±1°, typical webcam face-tracking noise
    const run = smooth => {
        const sy = createSmoother(), sp = createSmoother();
        const p = createPointer({ width: 1000, height: 800 }), dwell = createDwell();
        let minX = Infinity, maxX = -Infinity, clicked = false;
        for (let f = 0; f < 60; f++) {                       // 2 s of a still head at 30 fps
            const t = f / 30, yaw = 10 + noise(), pitch = 5 + noise();
            const pos = smooth ? p.update(sy(yaw, t), sp(pitch, t)) : p.update(yaw, pitch);
            if (f > 5) { minX = Math.min(minX, pos.x); maxX = Math.max(maxX, pos.x); }
            clicked = dwell(pos.x, pos.y, t * 1000).click || clicked;
        }
        return { spread: maxX - minX, clicked };
    };
    const raw = run(false), smoothed = run(true);
    assert.ok(raw.spread > 28 && !raw.clicked, `raw jitter should break rest-click (spread ${raw.spread})`);
    assert.ok(smoothed.spread < 28 && smoothed.clicked, `smoothed pointer should hold still and click (spread ${smoothed.spread})`);

    const s = createSmoother();
    let out = 0;
    for (let f = 0; f <= 18; f++) out = s(f <= 9 ? (f / 9) * 20 : 20, f / 30); // 20° turn in 0.3 s, then hold 0.3 s
    assert.ok(Math.abs(out - 20) < 1.5, `fast move should settle near 20° quickly (got ${out.toFixed(2)})`);
});

test('yaw unwrap keeps a turn across ±180° small before smoothing', () => {
    const { createUnwrap, createSmoother } = require('../public/head-pointer.js');
    const u = createUnwrap(), s = createSmoother();
    const out = [178, 179, -179, -178].map((y, i) => s(u(y), i / 30));
    assert.equal(u(-177) - 178, 5);                                   // 178° -> -177° is +5°, not -355°
    assert.ok(out.every((v, i) => i === 0 || Math.abs(v - out[i - 1]) < 3), `smoothed steps stay small: ${out}`);
});

test('dwell restarts after a tracking gap instead of clicking on the first frame back', () => {
    const dwell = createDwell({ radius: 28, ms: 1000 });
    dwell(500, 400, 0);
    dwell(500, 400, 100);                                   // tracking lost after 100 ms...
    assert.equal(dwell(510, 400, 1050).click, false);       // ...back at 1050 ms: no instant click
    let clickedAt = null;
    for (let t = 1083; t <= 2100 && clickedAt === null; t += 33) if (dwell(510, 400, t).click) clickedAt = t;
    assert.ok(clickedAt >= 2050, `uninterrupted tracking clicks a full second after tracking returned (at ${clickedAt})`);
});

test('a completed click stays latched across tracking pauses; unfinished rest restarts', () => {
    const d = createDwell({ radius: 28, ms: 1000 });
    let clicks = 0;
    for (let t = 0; t <= 1100; t += 33) clicks += d(500, 400, t).click ? 1 : 0;
    assert.equal(clicks, 1);
    for (let t = 1500; t <= 3000; t += 33) clicks += d(500, 400, t).click ? 1 : 0; // 400 ms pause, still on the button
    assert.equal(clicks, 1, 'no second click after a pause without moving');
    for (let t = 3033; t <= 4200; t += 33) clicks += d(600, 400, t).click ? 1 : 0; // moved away: re-armed
    assert.equal(clicks, 2);
    const u = createDwell({ radius: 28, ms: 1000 });
    for (let t = 0; t <= 600; t += 33) u(100, 100, t);
    u.interrupt();                                                     // face lost at 60% progress
    assert.equal(u(100, 100, 633).progress, 0, 'unfinished rest starts over after an interrupt');
});

test('rebase after tracking loss: the first pose back does not jump the pointer', () => {
    const p = createPointer({ width: 1000, height: 800, gain: 22 });
    p.update(0, 0); p.update(-2, 0);
    const x = p.x, y = p.y;
    p.rebase();
    p.update(-20, 5);                                                  // head moved while untracked
    assert.equal(p.x, x);
    assert.equal(p.y, y);
    p.update(-21, 5);
    assert.equal(p.x, x + 22);                                         // normal tracking resumes
});
