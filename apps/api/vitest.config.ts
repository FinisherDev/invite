import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Loaded in the main process, so the test workers inherit these variables.
config({ path: path.resolve(__dirname, '.env.test'), override: true });

export default defineConfig({
  resolve: {
    alias: { '@ticketly/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    fileParallelism: false, // one shared database, so files run serially
    coverage: { provider: 'v8', include: ['src/**'] },
  },
});