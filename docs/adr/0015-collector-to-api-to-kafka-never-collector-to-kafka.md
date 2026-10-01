# ADR-0015: Collector to API to Kafka, never collector to Kafka

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Clients run on user machines on the public internet.

## Decision

The collector posts batches to the API, which validates them and produces to Kafka.

## Consequences

Kafka is never exposed; one auth model; server-side validation.

## Alternatives considered

Direct produce with per-client Kafka credentials.
