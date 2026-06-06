import { defineConfig } from 'vitest/config';

// Engine-only unit tests. The scheduling engine is pure (no DB/React), so the
// node environment with no setup files keeps the suite fast and deterministic.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['features/labor/engine/**/*.test.ts'],
  },
});
