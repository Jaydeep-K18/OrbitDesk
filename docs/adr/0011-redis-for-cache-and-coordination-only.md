# ADR-0011: Redis for cache and coordination only

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Hot reads (extension state polling) and live counters need speed.

## Decision

Redis holds the active-session snapshot, live counters, caches, rate limits and BullMQ jobs. Every cache key has a TTL and is rebuildable from Postgres.

## Consequences

Losing Redis degrades performance, not correctness.

## Alternatives considered

Redis as a primary store: durability and query limits.
