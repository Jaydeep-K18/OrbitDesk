# ADR-0001: TypeScript monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Web, API, workers and the extension must share request/response and event contracts. Separate repositories drift.

## Decision

One pnpm workspace (`apps/*`, `packages/*`) orchestrated by Turborepo. Shared Zod contracts live in `packages/contracts`; pure logic in `packages/domain`. TypeScript `strict` everywhere.

## Consequences

Atomic cross-cutting changes; one lockfile; affected-only CI. Requires discipline about package boundaries (enforced by ESLint for `packages/domain`).

## Alternatives considered

Polyrepo: contract drift between extension and API; duplicated tooling.
