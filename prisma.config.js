import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
    // directUrl for migrations (session pooler)
    directUrl: env("DIRECT_URL"),
    // optional directUrl for migrations
    // directUrl: env("DIRECT_URL"),
  },
});
