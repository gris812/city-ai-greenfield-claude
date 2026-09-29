import { defineConfig } from 'vitest/config';

/** Pure-logic tests only (src/logic/**): no React Native runtime is loaded. */
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
