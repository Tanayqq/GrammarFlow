const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const dgram = require('node:dgram');
const path = require('node:path');

const python = process.platform === 'win32' ? 'python' : 'python3';

function handshake(origin) {
    return new Promise((resolve, reject) => {
        const sock = net.connect(18765, '127.0.0.1', () => sock.write(
            'GET / HTTP/1.1\r\nHost: 127.0.0.1:18765\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`));
        sock.once('data', d => resolve({ sock, head: d.toString() }));
        sock.on('error', reject);
    });
}

test('bridge relays OpenTrack packets to allowed pages only', async t => {
    const bridge = spawn(python, ['-I', path.join(__dirname, '..', 'helpers', 'head_bridge.py')]);
    t.after(() => bridge.kill());
    await new Promise((resolve, reject) => {
        bridge.stdout.on('data', d => d.toString().includes('ready') && resolve());
        bridge.on('error', reject);
        setTimeout(() => reject(new Error('bridge did not start')), 5000);
    });

    const denied = await handshake('https://evil.example');
    assert.match(denied.head, /^HTTP\/1\.1 403/);
    denied.sock.destroy();

    const { sock, head } = await handshake('https://grammarflowt.vercel.app');
    t.after(() => sock.destroy());
    assert.match(head, /^HTTP\/1\.1 101/);
    assert.match(head, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/); // RFC 6455 example

    const frame = new Promise(resolve => sock.once('data', resolve));
    const packet = Buffer.alloc(48);
    [0, 0, 0, 12.5, -4, 3].forEach((v, i) => packet.writeDoubleLE(v, i * 8)); // x y z yaw pitch roll
    const udp = dgram.createSocket('udp4');
    await new Promise(r => udp.send(packet, 4242, '127.0.0.1', r));
    udp.close();

    const data = await frame;
    assert.equal(data[0], 0x81);                            // final text frame
    assert.deepEqual(JSON.parse(data.subarray(2, 2 + data[1]).toString()), { yaw: -12.5, pitch: -4 });
});
