# Contributing to FocusGuard

## Workflow

- **Trunk-based.** Use short-lived branches off `main` (`feat/…`, `fix/…`, `chore/…`) and open a PR using the template. `main` is protected: CI must pass.
- **Conventional Commits** are enforced by commitlint: `feat(api): add session extend endpoint`.
- **Phase gates.** Work follows `ROADMAP.md`. A phase is complete only when every exit criterion is ticked.
- **Decisions** that deviate from the roadmap get an ADR (`docs/adr/0000-template.md`).

## Conventions (ROADMAP §20)

- **IDs and time.** IDs are UUIDv7 (`uuidv7()` from `@focusguard/domain`). Timestamps are `timestamptz` in UTC. The user's time zone is an IANA name. Inject a `Clock`; never call `new Date()` in business logic.
- **API.** Base path `/api/v1`. JSON is camelCase and the DB is snake_case. Errors are RFC 9457 `application/problem+json` with a `code`. Every boundary is validated with Zod schemas from `@focusguard/contracts`.
- **Pure domain package.** `packages/domain` must stay pure: no I/O or framework imports (enforced by ESLint).
- **Module layering.** Each API module follows routes → controller (validation) → service (rules) → repository (DB). Services never import Express.
- **Authorization.** Every repository function takes `userId` and scopes its query. Another user's resource returns `404`.
- **Code style.** No `any`; use typed errors (`AppError`).

## Tests

- **Unit tests:** colocated `*.test.ts(x)` or `tests/**/*.test.ts`.
- **API integration tests:** `apps/api/tests/**/*.int.test.ts`, run against a real Postgres (`pnpm test:integration`).
- **Coverage targets:** `packages/domain` ≥ 90%, API services ≥ 80%, web ≥ 70%.

## Definition of Done

See ROADMAP §23. The PR template mirrors it.
