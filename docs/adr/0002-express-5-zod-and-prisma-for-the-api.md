# ADR-0002: Express 5, Zod and Prisma for the API

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The spec names Node/Express. We need validation, typed DB access and migrations with low ceremony.

## Decision

Express 5 with an app factory (`createApp(deps)`), Zod at every boundary (doubles as the OpenAPI source), Prisma 6 for schema and migrations, with hand-written SQL where Prisma has no syntax (exclusion constraints, partitions).

## Consequences

Simple and testable without a listening server. Analytics queries use raw SQL via `$queryRaw`.

## Alternatives considered

NestJS (heavier abstractions than needed); Drizzle (good, but Prisma migrations are friendlier).
