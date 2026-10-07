import { execSync } from 'node:child_process';

export async function setup() {
  const dbName = new URL(process.env.DATABASE_URL ?? '').pathname;
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run: database "${dbName}" doesn't look like a test database`);
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}