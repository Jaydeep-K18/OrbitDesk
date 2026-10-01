# ADR-0012: EventBus seam in Phase 1, Kafka in Phase 4

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Event-driven architecture is a goal, but the MVP must ship first.

## Decision

Feature code publishes through an `EventBus` interface: an in-process driver in Phase 1 and a Kafka driver in Phase 4 (`EVENT_BUS_DRIVER`).

## Consequences

The Kafka migration is a driver swap plus shadow comparison, not a rewrite.

## Alternatives considered

Kafka from day one: premature operational complexity.
