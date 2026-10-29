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
      'src/users/__tests__/**/*.test.ts',
      'src/lib/__tests__/**/*.test.ts',
      'src/fare/__tests__/**/*.test.ts',
      'src/pricing/__tests__/**/*.test.ts',
      'src/travelMate/__tests__/**/*.test.ts',
      'src/poolRideRequests/__tests__/**/*.test.ts',
      'src/poolRides/__tests__/**/*.test.ts',
      'src/commute/__tests__/**/*.test.ts',
      'src/drivers/__tests__/**/*.test.ts',
      'src/payments/__tests__/**/*.test.ts',
      'src/scheduledRides/__tests__/**/*.test.ts',
      'src/trips/__tests__/**/*.test.ts',
      // Rider↔driver and rider↔rider ratings, and the admin ride record. Added
      // explicitly because this list is a whitelist, not a glob over src — a
      // suite in a directory nobody added here runs green locally and is never
      // run by `npm test`, which is the worst of both worlds.
      'src/ratings/__tests__/**/*.test.ts',
      'src/admin/__tests__/**/*.test.ts',
      'src/partners/__tests__/**/*.test.ts',
      'src/dailyRoutes/__tests__/**/*.test.ts',
      'src/sharedPools/__tests__/**/*.test.ts',
      'src/businessAds/__tests__/**/*.test.ts',
      'src/analytics/__tests__/**/*.test.ts',
      'src/locations/__tests__/**/*.test.ts',
      'src/maps/__tests__/**/*.test.ts',
      'src/social/__tests__/**/*.test.ts',
      'src/whatsapp/__tests__/**/*.test.ts',
      'src/specialRides/__tests__/**/*.test.ts',
      'src/traffic/__tests__/**/*.test.ts',
      // Velocity Studio: workspaces, plans and payments for the desk's customers.
      'src/studio/__tests__/**/*.test.ts',
      // The sales agent: what it fetches, reads, asks the map for and refuses to send.
      'src/sales/__tests__/**/*.test.ts',
      // The engine that watches every other feature. Easy one to forget, and
      // a QA engine nobody tests is a QA engine nobody can trust.
      'src/qa/__tests__/**/*.test.ts',
      // Usernames and personal fleets — written with tests that were never run.
      'src/fleet/__tests__/**/*.test.ts',
      // How real users break the system, one attack per case.
      'src/__tests__/**/*.test.ts',
      // In-app calls (who may ring whom) and the AI phone helpline.
      'src/calls/__tests__/**/*.test.ts',
      'src/support/__tests__/**/*.test.ts',
      // The AI meter, keys and budgets; the AI agents' calls, WhatsApp and billing.
      'src/ai/__tests__/**/*.test.ts',
      'src/agents/__tests__/**/*.test.ts',
    ],
    // All test files share one Firestore emulator — run them sequentially.
    // vitest 4: poolOptions is gone; forks.*  and fileParallelism are top-level.
    pool: 'forks',
    forks: { singleFork: true },
    fileParallelism: false,
  },
});
