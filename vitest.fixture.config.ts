// Regenerates tests/fixtures/sample-vault with the app's own crypto code: `npm run fixture`.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/make-fixture.fixture.ts'],
    testTimeout: 120_000,
  },
})
