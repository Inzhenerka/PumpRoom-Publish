# Development

This is a Node.js 24 GitHub Action. Use Bun 1.4.2 for dependencies and scripts.
Install with `bun install --frozen-lockfile`.

- Source: `src/`; tests: `__tests__/`; mocks: `__fixtures__/`.
- Format with `bun run format` (oxfmt), lint with `bun run lint` (oxlint).
- Run `bun run check` for TypeScript and `bun run test` for Vitest coverage.
- Build with `bun run build` (esbuild). Commit `dist/index.cjs` and its source map;
  GitHub runs that bundle directly without installing dependencies.
- Run `bun run verify` before committing; CI also checks that dist matches source.
- Use Conventional Commits. `feat!` / `BREAKING CHANGE` requires a major release.
- Release only when explicitly requested. `bun run release:dry-run` previews;
  `bun run release` publishes via release-it and updates the matching v<major>
  branch without force-push. npm publishing is disabled.
