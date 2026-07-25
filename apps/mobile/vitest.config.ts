import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the voice layer only.
 *
 * src/voice is pure TypeScript — it imports nothing from React Native, Expo or
 * Firebase — so it runs in a plain Node environment with no native mocking and
 * no emulator. That is deliberate: the language rules are the part of this
 * feature most likely to regress, and they are the part cheapest to test.
 *
 * Screens are not covered here; they need a React Native test environment this
 * app does not otherwise have.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: ['verbose'],
    include: ['src/voice/__tests__/**/*.test.ts'],
  },
});
