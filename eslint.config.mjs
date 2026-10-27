import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The load-test scripts are plain CommonJS for Node.
  {
    files: ["scripts/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate packages with their own checks: backend/functions runs its own
    // eslint config, the Expo app is typechecked and tested in CI.
    "backend/**",
    "apps/**",
    // Local git worktrees parked inside the repo; each is a full copy of it.
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
