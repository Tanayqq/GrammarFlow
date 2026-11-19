const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fingerToScreen, pinchRatio, createPinch } = require('../public/head-pointer.js');

test('fingertip maps mirrored, using the central camera area for the whole screen', () => {
    assert.deepEqual(fingerToScreen(0.5, 0.5, 1000, 800), { x: 499.5, y: 399.5 });
    assert.deepEqual(fingerToScreen(0.8, 0.2, 1000, 800), { x: 0, y: 0 });       // camera right edge of the box = screen left
    assert.deepEqual(fingerToScreen(0.2, 0.8, 1000, 800), { x: 999, y: 799 });   // last clickable pixel, never past it
    assert.deepEqual(fingerToScreen(0.99, 0.01, 1000, 800), { x: 0, y: 0 });     // outside the box: clamped, never off-screen
});

test('pinch ratio is relative to hand size, so near and far hands agree', () => {
    const hand = (scale, gap) => {
        const h = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
        h[0] = { x: 0.5, y: 0.5 + 0.2 * scale }; h[9] = { x: 0.5, y: 0.5 };       // wrist below the middle knuckle
        h[4] = { x: 0.5, y: 0.4 }; h[8] = { x: 0.5 + (gap * 0.2 * scale) / (4 / 3), y: 0.4 };
        return h;
    };
    assert.ok(Math.abs(pinchRatio(hand(1, 0.25)) - pinchRatio(hand(0.5, 0.25))) < 1e-9);
    assert.ok(Math.abs(pinchRatio(hand(1, 0.25)) - 0.25) < 1e-9);
});

test('pinch clicks once per close, with hysteresis and a hold while closing', () => {
    const pinch = createPinch({ close: 0.3, open: 0.5, hold: 0.5 });
    assert.deepEqual(pinch(0.9), { click: false, hold: false });
    assert.deepEqual(pinch(0.45), { click: false, hold: true });                // closing: freeze the pointer
    assert.deepEqual(pinch(0.2), { click: true, hold: true });                  // closed: one click
    assert.equal(pinch(0.1).click, false);
    assert.equal(pinch(0.4).click, false);                                      // wobble below "open": still the same pinch
    assert.equal(pinch(0.25).click, false);
    assert.deepEqual(pinch(0.6), { click: false, hold: false });                // released
    assert.equal(pinch(0.2).click, true);                                       // a new pinch clicks again
});

test('hand tracker: points from the index knuckle, clicks once per pinch, freezes while pinching', () => {
    const { createHandTracker } = require('../public/head-pointer.js');
    const W = 1000, H = 800;
    const handAt = (sx, sy, gap) => {                       // index tip at screen (sx, sy); gap = pinch ratio
        const nx = 1 - (0.2 + (sx / W) * 0.6), ny = 0.2 + (sy / H) * 0.6;
        const h = Array.from({ length: 21 }, () => ({ x: nx, y: ny + 0.1 }));
        h[8] = { x: nx, y: ny }; h[5] = { x: nx, y: ny }; h[9] = { x: nx, y: ny + 0.1 }; h[0] = { x: nx, y: ny + 0.3 };
        h[4] = { x: nx + (gap * 0.2) / (4 / 3), y: ny };
        return h;
    };
    const track = createHandTracker();
    let t = 0, last, clicks = 0;
    const frame = (sx, sy, gap) => { last = track(handAt(sx, sy, gap), (t += 1 / 30), W, H); clicks += last.click ? 1 : 0; return last; };
    assert.equal(track(null, 0, W, H), null);                                  // no hand: nothing
    for (let i = 0; i < 30; i++) frame(600, 400, 0.9);                         // hold an open hand still for 1 s
    assert.ok(Math.abs(last.x - 600) < 2 && Math.abs(last.y - 400) < 2, `settles where the hand points (${last.x}, ${last.y})`);
    assert.equal(clicks, 0, 'an open hand never clicks');
    const before = { x: last.x, y: last.y };
    frame(615, 410, 0.42);                                                     // fingers closing pull the tip a little
    frame(625, 418, 0.15);                                                     // pinched
    assert.equal(clicks, 1);
    assert.ok(Math.hypot(last.x - before.x, last.y - before.y) < 1, 'click lands where you were pointing');
    for (let i = 0; i < 10; i++) frame(625, 418, 0.1);                         // keep pinching
    assert.equal(clicks, 1, 'holding the pinch does not repeat');
    for (let i = 0; i < 3; i++) frame(600, 400, 0.9);                          // open
    frame(600, 400, 0.15);                                                     // pinch again
    assert.equal(clicks, 2);
});

test('a held pinch is not a new click after tracking restarts (slow camera, hand briefly lost)', () => {
    const { createHandTracker, createGesture } = require('../public/head-pointer.js');
    const hand = gap => {
        const h = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
        h[8] = { x: 0.5, y: 0.5 }; h[9] = { x: 0.5, y: 0.6 }; h[0] = { x: 0.5, y: 0.8 }; h[4] = { x: 0.5 + (gap * 0.2) / (4 / 3), y: 0.5 };
        return h;
    };
    const gesture = createGesture();
    let clicks = 0;
    for (let i = 0; i < 4; i++) {                                // each frame arrives after a "stall": tracker restarts
        const track = createHandTracker(gesture);
        clicks += track(hand(0.1), i, 1000, 800).click ? 1 : 0;
    }
    assert.equal(clicks, 1, 'one pinch, one click, however often tracking restarts');
});

test('a pinch that closes across a camera stall still clicks where you were pointing', () => {
    const { createHandTracker, createGesture } = require('../public/head-pointer.js');
    const W = 1000, H = 800;
    const handAt = (sx, sy, gap) => {
        const nx = 1 - (0.2 + (sx / (W - 1)) * 0.6), ny = 0.2 + (sy / (H - 1)) * 0.6;
        const h = Array.from({ length: 21 }, () => ({ x: nx, y: ny + 0.1 }));
        h[8] = { x: nx, y: ny }; h[5] = { x: nx, y: ny }; h[9] = { x: nx, y: ny + 0.1 }; h[0] = { x: nx, y: ny + 0.3 };
        h[4] = { x: nx + (gap * 0.2) / (4 / 3), y: ny };
        return h;
    };
    const gesture = createGesture();
    createHandTracker(gesture)(handAt(600, 400, 0.9), 1.0, W, H);            // open hand pointing at (600, 400)
    const after = createHandTracker(gesture)(handAt(625, 418, 0.1), 1.3, W, H); // 300 ms stall, tracker restarted, now pinched
    assert.equal(after.click, true);
    assert.ok(Math.hypot(after.x - 600, after.y - 400) < 1, `clicked at (${after.x}, ${after.y})`);

    const stale = createGesture();
    createHandTracker(stale)(handAt(100, 100, 0.9), 1.0, W, H);              // pointed somewhere long ago
    const back = createHandTracker(stale)(handAt(625, 418, 0.1), 5.0, W, H); // hand returns 4 s later, pinched
    assert.ok(Math.hypot(back.x - 625, back.y - 418) < 1, 'an old position is never reused');
});

test('a real pinch with the palm facing the camera registers (3D points), though it looks open in 2D', () => {
    const { pinchRatio, createHandTracker } = require('../public/head-pointer.js');
    const flat = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
    flat[0] = { x: 0.5, y: 0.53 }; flat[9] = { x: 0.5, y: 0.5 };      // palm towards the camera: looks very short
    flat[8] = { x: 0.5, y: 0.45 }; flat[4] = { x: 0.52, y: 0.45 };    // tips 0.02 apart
    const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    world[0] = { x: 0, y: 0.03, z: 0.08 }; world[9] = { x: 0, y: 0, z: 0 };  // real palm ~8.5 cm
    world[8] = { x: 0, y: -0.06, z: -0.02 }; world[4] = { x: 0.012, y: -0.06, z: -0.02 }; // tips 1.2 cm apart
    assert.ok(pinchRatio(flat) > 0.5, '2D alone thinks the hand is open');
    assert.ok(pinchRatio(flat, 4 / 3, world) < 0.2, '3D sees the pinch');
    const out = createHandTracker()(flat, 0, 1000, 800, 4 / 3, world);
    assert.equal(out.click, true);
    assert.equal(out.hold, true);
});

test('pointer acceleration: slow moves are precise, fast moves go far, rest is steady', () => {
    const { createHandTracker } = require('../public/head-pointer.js');
    const W = 1000, H = 800;
    const handAt = (sx, sy) => {
        const nx = 1 - (0.2 + (sx / (W - 1)) * 0.6), ny = 0.2 + (sy / (H - 1)) * 0.6;
        const h = Array.from({ length: 21 }, () => ({ x: nx, y: ny + 0.1 }));
        h[5] = h[8] = { x: nx, y: ny }; h[9] = { x: nx, y: ny + 0.1 }; h[0] = { x: nx, y: ny + 0.3 }; h[4] = { x: nx + 0.2, y: ny };
        return h;
    };
    const track = createHandTracker();
    let t = 0, p;
    const move = (from, to, seconds) => {
        const n = Math.round(seconds * 30), start = p ? p.x : null;
        for (let i = 1; i <= n; i++) p = track(handAt(from + ((to - from) * i) / n, 400), (t += 1 / 30), W, H);
        for (let i = 0; i < 15; i++) p = track(handAt(to, 400), (t += 1 / 30), W, H); // stop and settle
        return p.x - start;
    };
    for (let i = 0; i < 30; i++) p = track(handAt(300, 400), (t += 1 / 30), W, H);
    assert.ok(Math.abs(p.x - 300) < 1, 'starts where the hand points');
    const slow = move(300, 360, 1);                                                 // 60 px/s
    assert.ok(slow > 25 && slow < 40, `slow 60 px hand move -> ${slow.toFixed(1)} px pointer move`);
    const fast = move(360, 660, 0.2);                                               // 1500 px/s
    assert.ok(fast > 330, `fast 300 px hand move -> ${fast.toFixed(1)} px pointer move`);
    let seed = 3, min = Infinity, max = -Infinity;
    const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 6; }; // ±3 px of tracking noise
    for (let i = 0; i < 60; i++) {
        p = track(handAt(660 + noise(), 400 + noise()), (t += 1 / 30), W, H);
        if (i > 20) { min = Math.min(min, p.x); max = Math.max(max, p.x); }
    }
    assert.ok(max - min < 3, `resting pointer wobbles ${(max - min).toFixed(1)} px`);
});

test('a camera stall never makes the pointer jump by the movement it missed', () => {
    const { createHandTracker, createGesture } = require('../public/head-pointer.js');
    const W = 1000, H = 800;
    const handAt = sx => {
        const nx = 1 - (0.2 + (sx / (W - 1)) * 0.6), ny = 0.5;
        const h = Array.from({ length: 21 }, () => ({ x: nx, y: ny + 0.1 }));
        h[5] = h[8] = { x: nx, y: ny }; h[9] = { x: nx, y: ny + 0.1 }; h[0] = { x: nx, y: ny + 0.3 }; h[4] = { x: nx + 0.2, y: ny };
        return h;
    };
    const gesture = createGesture();
    const before = createHandTracker(gesture);
    let p, t = 0;
    for (let i = 0; i < 10; i++) p = before(handAt(100), (t += 1 / 30), W, H);
    const after = createHandTracker(gesture);                       // 300 ms stall: tracker restarted
    p = after(handAt(700), (t += 0.3), W, H);                       // the hand moved 600 px meanwhile
    assert.ok(Math.abs(p.x - 100) < 1, `pointer carries on from where it was (${p.x.toFixed(1)}), no jump`);
    p = after(handAt(710), (t += 1 / 30), W, H);
    assert.ok(p.x > 100 && p.x < 120, `then follows the hand's new movement (${p.x.toFixed(1)})`);
});
