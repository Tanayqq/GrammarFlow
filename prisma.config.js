import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres",
    directUrl: process.env.DIRECT_URL || "postgresql://postgres:postgres@localhost:5432/postgres",
  },
});

