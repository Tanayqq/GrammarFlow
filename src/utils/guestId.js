// The guest session id works like a password for a guest's history, and it is stored and indexed, so it must be a plain,
// bounded token. Both the web app and the extension create UUIDs; this also accepts other short letters/digits/-/_ tokens.
const PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// The id if it is a plain token, otherwise null (missing, not a string, too short or long, odd characters).
const cleanGuestId = value => (typeof value === 'string' && PATTERN.test(value) ? value : null);

// The id from the request header, or null.
const readGuestId = req => cleanGuestId(req.headers['x-guest-session-id']);

module.exports = { readGuestId, cleanGuestId, PATTERN };
