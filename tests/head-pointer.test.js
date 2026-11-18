const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPointer, createDwell } = require('../public/head-pointer.js');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

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

