import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/index.js';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL!,
});

export const prisma = new PrismaClient({ adapter });
