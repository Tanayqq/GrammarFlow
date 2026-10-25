const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

test('patched mail library preserves the verification-message transport contract', async () => {
    // Exercises the real mail library without contacting an external mail server.
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const info = await transport.sendMail({ from: 'GrammarFlow <sender@example.com>', to: 'recipient@example.com',
        subject: 'GrammarFlow verification code', text: 'Your verification code is 123456.' });
    assert.deepEqual(info.envelope.to, ['recipient@example.com']);
    assert.equal(info.envelope.from, 'sender@example.com');
    assert.match(info.message.toString('utf8'), /Your verification code is 123456/);
    transport.close();
});
