import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    setupFiles: ['./src/travelMate/__tests__/setup.ts'],
    include: [
      'src/auth/__tests__/**/*.test.ts',
      'src/lib/__tests__/**/*.test.ts',
      'src/travelMate/__tests__/**/*.test.ts',
      'src/poolRideRequests/__tests__/**/*.test.ts',
      'src/poolRides/__tests__/**/*.test.ts',
      'src/commute/__tests__/**/*.test.ts',
      'src/drivers/__tests__/**/*.test.ts',
      'src/payments/__tests__/**/*.test.ts',
      'src/scheduledRides/__tests__/**/*.test.ts',
      'src/trips/__tests__/**/*.test.ts',
      'src/partners/__tests__/**/*.test.ts',
      'src/dailyRoutes/__tests__/**/*.test.ts',
      'src/businessAds/__tests__/**/*.test.ts',
    ],
    // All test files share one Firestore emulator — run them sequentially.
    // vitest 4: poolOptions is gone; forks.*  and fileParallelism are top-level.
    pool: 'forks',
    forks: { singleFork: true },
    fileParallelism: false,
  },
});
