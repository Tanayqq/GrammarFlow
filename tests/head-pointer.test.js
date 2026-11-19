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


test('nod click (AirCursor-style): a quick dip-and-return clicks once, from where it began', () => {
    const { createNod, createDwell } = require('../public/head-pointer.js');
    const nod = createNod();
    let t = 0;
    const feed = (yaw, pitch) => nod(yaw, pitch, (t += 40));                 // 25 Hz, like AirPods
    for (let i = 0; i < 10; i++) assert.equal(feed(10, 0), null);           // still: nothing
    const start = t + 40;
    const shape = [0, -3, -6, -8, -6, -3, -1, 0, 0, 0, 0, 0, 0, 0];         // ~8° nod down and back in 280 ms
    const hits = shape.map(p => feed(10, p)).filter(v => v !== null);
    assert.equal(hits.length, 1, 'one nod, one click');
    assert.ok(hits[0] <= start, 'reports when the nod began');
    for (let i = 0; i < 10; i++) feed(10, 0);
    assert.equal(shape.map(p => feed(10, p)).filter(v => v !== null).length, 1, 'a second nod clicks again');

    const slow = createNod(); t = 0;                                        // looking down slowly and back: pointing, not a nod
    const slowHits = [];
    for (let i = 0; i <= 50; i++) slowHits.push(slow(0, -8 * Math.sin((Math.PI * i) / 50), (t += 40)));
    assert.ok(slowHits.every(v => v === null), 'slow movement never clicks');

    const diag = createNod(); t = 0;                                        // a glance sideways while dipping is not a nod
    assert.ok(shape.map((p, i) => diag(i * 4, p, (t += 40))).every(v => v === null));

    const small = createNod(); t = 0;
    assert.ok([0, -1, -2, -3, -2, -1, 0, 0].map(p => small(0, p, (t += 40))).every(v => v === null), 'a 3° bob is not a nod');

    const d = createDwell({ radius: 28, ms: 1000 });                        // after a nod click, resting there never clicks again
    d.latch(100, 100, 0);
    for (let ms = 40; ms <= 2000; ms += 40) assert.equal(d(100, 100, ms).click, false);
});

test('nod click lands where you pointed just before nodding, and its follow-through never clicks again', () => {
    const { createPointer, createDwell, createNod, createHeadCursor } = require('../public/head-pointer.js');
    const make = () => {
        const pointer = createPointer({ width: 2000, height: 2000 });
        return createHeadCursor({ pointer, dwell: createDwell({ radius: 28, ms: 1000 }), nod: createNod() });
    };
    let head = make(), t = 0, out;
    const feed = (yaw, pitch) => (out = head(yaw, pitch, (t += 40)));
    for (let i = 0; i < 10; i++) feed(0, 0);
    for (const yaw of [1, 2, 3, 4]) feed(yaw, 0);                           // turn 4° (88 px), then nod right away
    const aimed = { x: out.x, y: out.y };
    const nods = [-3, -6, -8, -6, -2].map(p => feed(4, p)).filter(o => o.nod);
    assert.equal(nods.length, 1);
    assert.ok(Math.hypot(nods[0].x - aimed.x, nods[0].y - aimed.y) < 1, `nod clicked at (${nods[0].x}, ${nods[0].y}), aimed at (${aimed.x}, ${aimed.y})`);

    const clicks = [];                                                      // follow-through: -2° back to 0°, then rest
    for (const p of [-1, 0, 0, 0, 0, 0]) clicks.push(feed(4, p));
    for (let i = 0; i < 60; i++) clicks.push(feed(4, 0));
    assert.ok(clicks.every(o => !o.click && !o.nod), 'one nod is one click');
    assert.ok(Math.hypot(out.x - aimed.x, out.y - aimed.y) < 1, 'pointer stays where the nod clicked');

    feed(10, 0); feed(16, 0);                                               // moving away re-arms resting
    let dwelled = false;
    for (let i = 0; i < 40; i++) dwelled = feed(16, 0).click || dwelled;
    assert.ok(dwelled, 'resting somewhere new still clicks');
});

test('nod click edge cases: a pause on the way down, a nod right after a nod, a nod as a rest completes', () => {
    const { createPointer, createDwell, createNod, createHeadCursor } = require('../public/head-pointer.js');
    const make = () => createHeadCursor({ pointer: createPointer({ width: 2000, height: 2000 }), dwell: createDwell({ radius: 28, ms: 1000 }), nod: createNod() });
    let head, t, out;
    const feed = (yaw, pitch) => (out = head(yaw, pitch, (t += 40)));

    head = make(); t = 0;                                                    // brief plateau at -3° on the way down
    for (let i = 0; i < 10; i++) feed(0, 0);
    let aimed = { x: out.x, y: out.y };
    let hit = [-3, -3, -6, -8, -6, -2].map(p => feed(0, p)).find(o => o.nod);
    assert.ok(hit && Math.hypot(hit.x - aimed.x, hit.y - aimed.y) < 1, 'plateau: clicks where you aimed');

    for (const p of [0, 0, 0, 0, 0, 0]) feed(0, p);                          // settle, then nod again immediately
    aimed = { x: out.x, y: out.y };
    hit = [-3, -6, -8, -6, -2].map(p => feed(0, p)).find(o => o.nod);
    assert.ok(hit && Math.hypot(hit.x - aimed.x, hit.y - aimed.y) < 1, `second nod: clicked at ${hit && hit.y}, aimed at ${aimed.y}`);

    head = make(); t = 0;                                                    // nod starts just as a rest would complete
    const events = [];
    for (let i = 0; i < 25; i++) events.push(feed(0, 0));                    // 1000 ms of rest
    for (const p of [-1, -3, -6, -8, -6, -2, 0, 0, 0, 0, 0, 0]) events.push(feed(0, p));
    assert.equal(events.filter(o => o.click || o.nod).length, 1, 'one nod, one click');
});

test('nod click: aiming down just before a nod, and a gentle nod start as a rest completes', () => {
    const { createPointer, createDwell, createNod, createHeadCursor } = require('../public/head-pointer.js');
    const make = () => createHeadCursor({ pointer: createPointer({ width: 2000, height: 2000 }), dwell: createDwell({ radius: 28, ms: 1000 }), nod: createNod() });
    let head, t, out;
    const feed = (yaw, pitch) => (out = head(yaw, pitch, (t += 40)));

    head = make(); t = 0;
    for (let i = 0; i < 10; i++) feed(0, 0);
    for (const p of [-1, -2, -3, -4]) feed(0, p);                            // slow aiming down
    const aimed = { x: out.x, y: out.y };
    const hit = [-7, -10, -12, -10, -6].map(p => feed(0, p)).find(o => o.nod);
    assert.ok(hit && Math.hypot(hit.x - aimed.x, hit.y - aimed.y) < 1, `clicked at y=${hit && hit.y}, aimed at y=${aimed.y}`);

    head = make(); t = 0;
    const events = [];
    for (let i = 0; i < 25; i++) events.push(feed(0, 0));
    for (const p of [-0.2, -3, -6, -8, -6, -2, 0, 0, 0, 0, 0, 0]) events.push(feed(0, p));
    assert.equal(events.filter(o => o.click || o.nod).length, 1, 'a rest click and a nod on the same spot are one click');
});

test('nod click: a slow valid nod clicks where you aimed; a separate nod after a rest click still clicks', () => {
    const { createPointer, createDwell, createNod, createHeadCursor } = require('../public/head-pointer.js');
    const make = () => createHeadCursor({ pointer: createPointer({ width: 2000, height: 2000 }), dwell: createDwell({ radius: 28, ms: 1000 }), nod: createNod() });
    let head, t, out;
    const feed = (yaw, pitch) => (out = head(yaw, pitch, (t += 40)));

    head = make(); t = 0;
    for (let i = 0; i < 10; i++) feed(0, 0);
    const aimed = { x: out.x, y: out.y };
    const hit = [-1.4, -2.8, -4.2, -5.6, -4.2, -2.8, -1.4].map(p => feed(0, p)).find(o => o.nod); // 35°/s peak
    assert.ok(hit && Math.hypot(hit.x - aimed.x, hit.y - aimed.y) < 1, `clicked at y=${hit && hit.y}, aimed at y=${aimed.y}`);

    head = make(); t = 0;
    const events = [];
    for (let i = 0; i < 26; i++) events.push(feed(0, 0));                   // rest click at ~1040 ms
    for (let i = 0; i < 14; i++) events.push(feed(0, 0));                   // keep still until ~1600 ms
    for (const p of [-3, -6, -8, -6, -2, 0, 0, 0, 0, 0]) events.push(feed(0, p));
    assert.equal(events.filter(o => o.click).length, 1, 'the rest clicked');
    assert.equal(events.filter(o => o.nod).length, 1, 'the later nod clicked too');
});

test('nod click: slow way down and fast way back; a rest at the screen edge waits out a nod', () => {
    const { createPointer, createDwell, createNod, createHeadCursor } = require('../public/head-pointer.js');
    let head, t, out;
    const feed = (yaw, pitch) => (out = head(yaw, pitch, (t += 40)));

    head = createHeadCursor({ pointer: createPointer({ width: 2000, height: 2000 }), dwell: createDwell(), nod: createNod() }); t = 0;
    for (let i = 0; i < 10; i++) feed(0, 0);
    let aimed = { x: out.x, y: out.y };
    const hit = [-1, -2, -3, -4, -5, -6, -3, 0].map(p => feed(0, p)).find(o => o.nod); // 25°/s down, 75°/s back
    assert.ok(hit && Math.hypot(hit.x - aimed.x, hit.y - aimed.y) < 1, `clicked at y=${hit && hit.y}, aimed at y=${aimed.y}`);

    const at = y => -(y - 500) / 22;                                        // pitch that puts the pointer at y
    for (const shape of [[3, 6, 8, 6, 2], [3, 6, 8, 8, 6, 2], [3, 6, ...Array(12).fill(8), 2]]) { // plain nod, short and long pause at the bottom
        head = createHeadCursor({ pointer: createPointer({ width: 2000, height: 1000 }), dwell: createDwell(), nod: createNod() }); t = 0;
        feed(0, 0);
        for (let y = 500; y < 980; y += 20) feed(0, at(y));
        const events = [];
        do events.push(feed(0, at(980))); while (out.progress < 0.9);      // rest 20 px above the bottom edge
        events.push(feed(0, at(958)));                                     // aim 22 px higher, still inside the rest
        for (const p of [...shape, 0, 0, 0, 0, 0, 0]) events.push(feed(0, at(958) - p)); // nod: pinned at the edge
        assert.ok(events.some(o => o.y === 1000), 'the nod pinned the pointer at the edge');
        assert.equal(events.filter(o => o.click || o.nod).length, 1, `one nod at the edge is one click (${shape})`);
    }
});

test('after a nod, a tracking gap never counts as the head settling', () => {
    const { createNod } = require('../public/head-pointer.js');
    const nod = createNod();
    let t = 0;
    const shape = [-3, -6, -8, -6, -2];
    for (let i = 0; i < 5; i++) nod(0, 0, (t += 40));
    assert.equal(shape.map(p => nod(0, p, (t += 40))).filter(v => v !== null).length, 1);
    nod(0, 0, (t += 40)); nod(0, 0, (t += 40));                             // back level, then still: the timer starts...
    nod(0, 0, (t += 300));                                                  // ...then a gap
    assert.ok(shape.map(p => nod(0, p, (t += 40))).every(v => v === null), 'not re-armed without 150 ms of stillness');
    assert.equal(nod.settling(), true);
});
