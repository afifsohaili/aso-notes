You are an expert full-stack developer with good insights into customer needs and user experience.

You are building the application with the following technologies:
- Frontend: Nuxt.js, Tailwind CSS, TypeScript
- Backend: /server folder in Nuxt.js (using Nitro as a base), Kysely, PostgreSQL
- Authentication: BetterAuth

## Commands
- Build: `pnpm build`
- Dev: `pnpm dev`
- Lint: `pnpm lint` (fix with `pnpm lint:fix`)
- Test: `vitest run` (single test: `vitest run test/components/landing-page.nuxt.spec.ts`)
- DB Migrate: `pnpm db:migrate`
- DB Migrate + Generate Types: `pnpm db:migrate:generate`
- DB Schema Dump: `pnpm db:schema:dump` (regenerates `apps/web/db/schema.sql` from migrations)

## Code Style
- Use @antfu/eslint-config with Vue support
- TypeScript strict mode enabled
- Vue 3 Composition API with `<script setup lang="ts">`
- Use `ref()` for primitives, `reactive()` for objects
- Error handling: try/catch with proper typing (`error instanceof Error`)
- Component naming: PascalCase for components, kebab-case in templates
- Use Tailwind CSS classes, avoid inline styles
- Internationalization with `useI18n()` composable
- Auth via `useAuthClient()` from better-auth/vue
- Database queries via Kysely with proper typing

## Icons
- Use `unplugin-icons` for all icons (configured in nuxt.config.ts)
- Import icons with `~icons/` prefix: `import BellIcon from '~icons/heroicons/bell'`
- Use the imported component directly: `<BellIcon class="h-6 w-6" />`
- Available icon sets: heroicons, lucide, mdi, and more
- **Do NOT use inline SVGs, `<img>` tags for icons, or other icon libraries directly**

## Tools
- Use web_search MCP to search the web for information
- Use browser MCP to check the application state and take actions

## Testing
- **Integration tests are preferred** over unit tests for testing API endpoints and full feature flows.
- Use `@base/testing` for e2e tests. The default tier is **in-process transactional**:
  - No Nuxt build, no server spawn.
  - One template DB per run, one DB per test file, one transaction per test (rolled back).
  - Use `test` from `@base/testing/test`, `givenVerifiedUser()` from `@base/testing/auth`, `fixtures` from `@base/testing/fixtures`, and `queue` for job assertions.
- Run the full suite:
  ```bash
  pnpm --filter web test
  ```
- Run only the fast e2e project:
  ```bash
  pnpm --filter web vitest run --project e2e
  ```
- Built-server tests (real HTTP/WebSocket) live in `test/e2e-built/` and run via the `e2e-built` project. One `nuxt build` per run; each file spawns one server from `.output/server`.
- `TEST_HOST=http://localhost:3001 pnpm vitest run test/e2e/` still works as a local dev loop, trading isolation for speed. CI never uses it.
- See `packages/testing/README.md` and `skills/write-e2e-test/SKILL.md` for templates and rules.

## Testing Tips
- Vitest swallows `console.log` output. Use `throw new Error(JSON.stringify(value))` to see values in test output instead.
