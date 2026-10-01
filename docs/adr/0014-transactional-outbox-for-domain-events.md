# ADR-0014: Transactional outbox for domain events

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Writing to Postgres and Kafka in one request risks lost or phantom events.

## Decision

Domain events are written to `outbox_events` in the same transaction as the state change; a relay publishes them.

## Consequences

Effectively-once processing with idempotent consumers.

## Alternatives considered

Producing to Kafka inside request handlers.
