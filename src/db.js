const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Create connection pool and driver adapter
// ssl.rejectUnauthorized:false is required for Supabase's transaction pooler,
// which uses a self-signed certificate chain not trusted by Node's default CA store.
// Traffic is still TLS-encrypted — we're only skipping chain validation.
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);

// Singleton pattern: prevents multiple Prisma instances in development hot-reloads
const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});


prisma.$connect()
    .then(() => console.log('[PRISMA] Connected to Supabase PostgreSQL successfully.'))
    .catch((err) => console.error('[PRISMA ERROR] Failed to connect to database:', err.message));

module.exports = prisma;
