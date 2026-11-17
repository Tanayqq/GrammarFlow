const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rotvecToYawPitch, findHeadTracker, encodeStart, decodeRotation } = require('../public/head-pointer.js');

// The example descriptor from Android's "Head tracker HID protocol" page, as WebHID parses it.
const item = (usages, reportSize, reportCount, extra = {}) => ({ usages, reportSize, reportCount, logicalMinimum: 0,
    logicalMaximum: 1, physicalMinimum: 0, physicalMaximum: 0, unitExponent: 0, ...extra });
const rotation = item([0x200544], 16, 3, { logicalMinimum: -32767, logicalMaximum: 32767,
    physicalMinimum: -314159265, physicalMaximum: 314159265, unitExponent: -8 });
const collections = [
    { usagePage: 0x01, usage: 0x06, inputReports: [], featureReports: [] },             // a keyboard
    { usagePage: 0x20, usage: 0xE1,
      featureReports: [
          { reportId: 2, items: [item([0x200308], 8, 23, { logicalMaximum: 255 }), item([0x200302], 8, 16, { logicalMaximum: 255 })] },
          { reportId: 1, items: [item([0x200840, 0x200841], 1, 1), item([0x200855, 0x200851], 1, 1),
                                 item([0x20030E], 6, 1, { logicalMaximum: 63 })] }],
      inputReports: [{ reportId: 1, items: [rotation,
          item([0x200545], 16, 3, { logicalMinimum: -32767, logicalMaximum: 32767, physicalMinimum: -32, physicalMaximum: 32 }),
          item([0x200546], 8, 1, { logicalMaximum: 255 })] }] }];

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('finds the head tracker and its reports, ignores other HID devices', () => {
    const t = findHeadTracker(collections);
    assert.equal(t.input.reportId, 1);
    assert.equal(t.control.reportId, 1);
    assert.equal(findHeadTracker([collections[0]]), null);
});

test('start report sets All Events, Full Power and a non-zero interval', () => {
    // bit0 reporting state = ALL_EVENTS(1), bit1 power = FULL_POWER(1), bits2-7 interval = 7
    assert.deepEqual([...encodeStart(findHeadTracker(collections).control)], [1 | 2 | (7 << 2)]);
});

test('decodes the rotation vector in radians, including the raw 4-bit exponent form', () => {
    const bytes = new Uint8Array(13);
    const view = new DataView(bytes.buffer);
    const toLogical = rad => Math.round(-32767 + (rad * 1e8 + 314159265) * 65534 / 628318530);
    [0.1, -0.25, 0.5].forEach((rad, i) => view.setInt16(i * 2, toLogical(rad), true));
    const tracker = findHeadTracker(collections);
    decodeRotation(tracker.input, bytes).forEach((v, i) => close(v, [0.1, -0.25, 0.5][i]));
    const nibble = { ...tracker.input, items: [{ ...rotation, unitExponent: 8 }] };
    close(decodeRotation(nibble, bytes)[2], 0.5);
});

test('head-frame rotation maps to yaw (left +) and pitch (up +)', () => {
    const deg = d => d * Math.PI / 180;
    let p = rotvecToYawPitch([0, 0, deg(30)]);   // about Z (up): turn left
    close(p.yaw, 30); close(p.pitch, 0);
    p = rotvecToYawPitch([deg(20), 0, 0]);       // about X (right ear): nose goes up
    close(p.yaw, 0); close(p.pitch, 20);
    p = rotvecToYawPitch([0, deg(40), 0]);       // roll only: pointer must not move
    close(p.yaw, 0); close(p.pitch, 0);
});
