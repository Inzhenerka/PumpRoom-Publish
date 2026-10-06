---
mode: agent
---

Write Vitest tests for the requested behavior. Use the Node environment and mocks
in `__fixtures__` where appropriate. Check observable outcomes, including failure
and cleanup paths. Run `bun run check` and `bun run test`. Bundle integration tests
use the committed `dist/index.cjs`; rebuild with `bun run build` after source changes.
