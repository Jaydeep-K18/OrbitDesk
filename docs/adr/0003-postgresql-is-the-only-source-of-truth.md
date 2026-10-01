# ADR-0003: PostgreSQL is the only source of truth

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Sessions, tasks and reports are relational and need integrity guarantees; Redis and Kafka are added later.

## Decision

PostgreSQL 17 owns all durable state. Redis and Kafka only hold rebuildable or transient copies.

## Consequences

Exclusion constraints, JSONB, partitioning and strong SQL analytics are available. Any cache can be rebuilt from Postgres.

## Alternatives considered

MongoDB: weak fit for relational sessions, tasks and reports.
