import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the app's pure logic only.
 *
 * src/voice (language rules) and the pure modules under src/lib import nothing
 * from React Native, Expo or Firebase, so they run in a plain Node environment
 * with no native mocking and no emulator. That is the bar for being covered
 * here: a module that reaches for a native API belongs on the other side of a
 * pure function, not in this suite.
 *
 * Screens are not covered here; they need a React Native test environment this
 * app does not otherwise have.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: ['verbose'],
    include: ['src/voice/__tests__/**/*.test.ts', 'src/lib/__tests__/**/*.test.ts'],
  },
});
