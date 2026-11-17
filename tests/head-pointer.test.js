const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quatToYawPitch, matrixToYawPitch, createPointer, createDwell } = require('../public/head-pointer.js');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('quaternion and matrix decode yaw/pitch', () => {
    const half = (Math.PI / 4) / 2; // 45° yaw about z
    const q = quatToYawPitch({ w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) });
    close(q.yaw, 45); close(q.pitch, 0);
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
    const dwell = createDwell({ radius: 10, ms: 1000 });
    assert.equal(dwell(100, 100, 0).click, false);
    assert.equal(dwell(105, 100, 500).progress, 0.5);
    assert.equal(dwell(103, 101, 1000).click, true);
    assert.equal(dwell(103, 101, 1500).click, false);     // no repeat while still resting
    dwell(300, 300, 1600);                                 // moved away: new anchor
    assert.equal(dwell(300, 300, 2600).click, true);
});
