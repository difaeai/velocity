import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    setupFiles: ['./src/travelMate/__tests__/setup.ts'],
    include: ['src/travelMate/__tests__/**/*.test.ts'],
    // All test files share one Firestore emulator — run them sequentially.
    // vitest 4: poolOptions is gone; forks.*  and fileParallelism are top-level.
    pool: 'forks',
    forks: { singleFork: true },
    fileParallelism: false,
  },
});
