import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.ts'],
    environment: 'node',
    globals: true,
    config: './tsconfig.vitest.json',
    pool: 'threads',
    restoreMocks: true,
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov']
    }
  },
  esbuild: {
    target: 'es2022'
  },
  resolve: {
    conditions: ['node']
  }
});


