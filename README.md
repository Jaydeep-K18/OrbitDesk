# FocusGuard

> **PLAN → FOCUS → MONITOR → BLOCK → ANALYZE → IMPROVE**

FocusGuard is a productivity platform for students and developers. It is made up of a React dashboard, a Node/Express API, a Chrome MV3 extension (blocking, a floating timer widget and activity tracking), context-aware activity analytics, a **free local AI planner (Ollama)**, Redis, Kafka, a C++/Npcap network collector and Python ML.

`ROADMAP.md` is the source of truth for scope, phases and progress.

## Quick start

Prerequisites:

- Node.js ≥ 20.18 (24 LTS recommended) and pnpm 9 (`npm i -g pnpm@9`)
- Docker Desktop, _or_ the Docker-free Postgres fallback (`pnpm db:dev`)
- Chrome
- Ollama with `llama3.2` pulled (needed from Phase 2)

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d   # or, without Docker: pnpm db:dev
pnpm --filter @focusguard/api prisma:deploy
pnpm dev
```

| Service             | URL                                 |
| ------------------- | ----------------------------------- |
| Dashboard           | http://localhost:5173               |
| API                 | http://localhost:4000/api/v1/health |
| Mailpit (dev email) | http://localhost:8025 (Docker only) |

### Load the extension

1. Run `pnpm dev` (or `pnpm --filter @focusguard/extension build --mode development`).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `apps/extension/.output/chrome-mv3-dev`.
3. The pinned dev key gives a stable ID: `dmfegmfpjfegcdhojmpbbghakajhgpec`.

## Common commands

| Command                                 | What it does                                                              |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck`          | ESLint / TypeScript across all workspaces                                 |
| `pnpm turbo run test`                   | Unit tests (Vitest)                                                       |
| `pnpm test:integration`                 | API integration tests against a real Postgres (creates `focusguard_test`) |
| `pnpm build`                            | Production builds (API bundle, SPA, extension)                            |
| `pnpm --filter @focusguard/api openapi` | Regenerate `docs/api/openapi.json`                                        |

## Repository layout

```text
apps/       web · api · extension · workers (P3+) · ml-service (P6) · collector (P5)
packages/   contracts (Zod schemas) · domain (pure logic) · config (env, tsconfig presets)
infra/      docker-compose, scripts
docs/       adr/ · api/ · design/ · runbooks/
```

## Documentation

- [ROADMAP.md](ROADMAP.md): phases, decisions, progress
- [docs/adr](docs/adr/README.md): architecture decision records
- [docs/design/wireframes.md](docs/design/wireframes.md): screen wireframes
- [CONTRIBUTING.md](CONTRIBUTING.md): workflow and conventions
