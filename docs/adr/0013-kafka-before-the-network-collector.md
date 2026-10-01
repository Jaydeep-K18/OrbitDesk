# ADR-0013: Kafka before the network collector

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Network flows are the highest-volume stream.

## Decision

Phase 4 (Kafka) precedes Phase 5 (collector), so flow ingestion is built once, directly into the event pipeline.

## Consequences

No throwaway ingestion path.

## Alternatives considered

The originally suggested order (network first).
