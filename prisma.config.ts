import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public",
  },
  experimental: {
    externalTables: true,
  },
  tables: {
    external: [
      "public.IntegrationConnection",
      "public.ExternalReference",
      "public.IntegrationInbox",
      "public.IntegrationOutbox",
      "public.PatientFileObjectStage",
    ],
  },
});
