// Tells "the database cannot be reached" apart from a bug in our code, so callers can answer 503 (try again later)
// instead of 500, and the logs can say what to check.
const DOWN_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1017', 'P2024']);
const DOWN_TEXT = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|Connection terminated|connection timeout|Can't reach database|self-signed|certificate|SSL|too many clients|password authentication/i;

function isDatabaseDown(error) {
    if (!error) return false;
    return error.name === 'PrismaClientInitializationError' || DOWN_CODES.has(error.code) || DOWN_TEXT.test(String(error.message || ''));
}

// One plain sentence on the most likely cause, for the server log (never sent to the browser).
function databaseHint(error) {
    const text = `${error?.code || ''} ${error?.message || ''}`;
    if (/certificate|self-signed|SSL/i.test(text)) return 'The database certificate is not trusted: set DATABASE_CA_CERT to the provider CA certificate.';
    if (/ENOTFOUND/.test(text)) return 'The database host name was not found: check DATABASE_URL.';
    if (/password authentication|P1000|28P01/.test(text)) return 'The database rejected the login: check the user and password in DATABASE_URL.';
    if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|P1001|P1002|P1017|Can't reach/.test(text)) {
        return 'The database cannot be reached: a Supabase project on a free plan pauses after about a week without use, so check it and press Restore.';
    }
    if (/too many clients|P2024/.test(text)) return 'The database has no free connections: check the pool size and the provider limit.';
    return '';
}

module.exports = { isDatabaseDown, databaseHint };
