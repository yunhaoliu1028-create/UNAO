import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "node:path";

// Resolve SQLite file path relative to project root.
const dbUrl =
  process.env.DATABASE_URL ||
  `file:${path.resolve(process.cwd(), "prisma", "dev.db")}`;

// Prevent multiple Prisma Client instances in development (hot-reload).
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function makePrisma(): PrismaClient {
  const adapter = new PrismaLibSql({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? makePrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
