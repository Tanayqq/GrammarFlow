// Logs can be read by anyone with access to the hosting dashboard or a log service, so they never carry secrets
// (a guest session id works like a password) or personal data. Print the start of an id, enough to follow one request.
const shortId = value => (typeof value === 'string' && value ? value.slice(0, 8) + '\u2026' : 'none');

module.exports = { shortId };
