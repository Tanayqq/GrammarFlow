const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Prevent URL sslmode/sslrootcert parameters from overriding explicit certificate validation.
const databaseUrl = new URL(process.env.DATABASE_URL);
for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) databaseUrl.searchParams.delete(key);
const pool = new Pool({
    connectionString: databaseUrl.toString(),
    ssl: {
        rejectUnauthorized: true,
        ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') } : {})
    }
});
const adapter = new PrismaPg(pool, { disposeExternalPool: true });

// Singleton pattern: prevents multiple Prisma instances in development hot-reloads
const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});


prisma.$connect()
    .then(() => console.log('[PRISMA] Connected to Supabase PostgreSQL successfully.'))
    .catch((err) => console.error('[PRISMA ERROR] Failed to connect to database:', err.message));

module.exports = prisma;
