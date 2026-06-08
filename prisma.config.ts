import { defineConfig } from '@prisma/client';

export default defineConfig({
  datasource: {
    // Prisma will read DATABASE_URL from the environment at runtime
    url: process.env.DATABASE_URL,
  },
});
