// Writing history is private text, so it is not kept forever: guests' entries expire after HISTORY_GUEST_DAYS (default 30),
// signed-in users' after HISTORY_USER_DAYS (default 365). Guest accounts left with nothing are removed too.
// HISTORY_RETENTION_DISABLED=true turns this off.
const DAY = 24 * 60 * 60 * 1000;

const days = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 && n <= 3650 ? n : fallback;
};

// Deletes in small batches, so one run never holds the database for long, and at most maxBatches per run.
async function deleteOperations(prisma, where, batch, maxBatches) {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
        const rows = await prisma.aiOperation.findMany({ where, select: { id: true }, take: batch });
        if (!rows.length) break;
        // The same conditions are checked again at delete time: an entry that was just moved to a signed-in account
        // (account sync) no longer qualifies and must survive.
        const { count } = await prisma.aiOperation.deleteMany({ where: { ...where, id: { in: rows.map(row => row.id) } } });
        total += count;
        if (rows.length < batch) break;
    }
    return total;
}

async function purgeExpiredHistory(prisma, { now = Date.now(), guestDays = 30, userDays = 365, batch = 500, maxBatches = 20 } = {}) {
    const guestCutoff = new Date(now - guestDays * DAY);
    const userCutoff = new Date(now - userDays * DAY);
    const guestOps = await deleteOperations(prisma, { created_at: { lt: guestCutoff }, user: { is: { email: null, password_hash: null } } }, batch, maxBatches);
    const userOps = await deleteOperations(prisma, { created_at: { lt: userCutoff }, user: { is: { OR: [{ email: { not: null } }, { password_hash: { not: null } }] } } }, batch, maxBatches);
    let guests = 0;
    for (let i = 0; i < maxBatches; i++) {
        const rows = await prisma.user.findMany({
            where: { email: null, password_hash: null, created_at: { lt: guestCutoff }, operations: { none: {} } },
            select: { id: true }, take: batch
        });
        if (!rows.length) break;
        const ids = rows.map(row => row.id);
        // Settings and account go in one transaction, each re-checking that the guest is still empty, so an account that
        // just got a new entry keeps both its settings and itself.
        const stillEmpty = { email: null, password_hash: null, operations: { none: {} } };
        const [, removed] = await prisma.$transaction([
            prisma.userSettings.deleteMany({ where: { user_id: { in: ids }, user: { is: stillEmpty } } }),
            prisma.user.deleteMany({ where: { id: { in: ids }, ...stillEmpty } })
        ]);
        guests += removed.count;
        if (rows.length < batch) break;
    }
    return { guestOps, userOps, guests };
}

// Runs a minute after start, then every six hours. Timers are unref'd so they never keep a process alive.
function start({ prisma = require('./db'), log = console } = {}) {
    if (process.env.HISTORY_RETENTION_DISABLED === 'true') return null;
    const options = { guestDays: days(process.env.HISTORY_GUEST_DAYS, 30), userDays: days(process.env.HISTORY_USER_DAYS, 365) };
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const done = await purgeExpiredHistory(prisma, options);
            if (done.guestOps || done.userOps || done.guests) log.log(`[RETENTION] Removed ${done.guestOps} guest and ${done.userOps} user history entries, and ${done.guests} empty guest accounts.`);
        } catch (error) {
            log.error('[RETENTION] History cleanup failed:', error.message, require('./utils/databaseError').databaseHint(error));
        } finally {
            running = false;
        }
    };
    setTimeout(run, 60 * 1000).unref();
    const timer = setInterval(run, 6 * 60 * 60 * 1000);
    timer.unref();
    return timer;
}

module.exports = { purgeExpiredHistory, start, days };
