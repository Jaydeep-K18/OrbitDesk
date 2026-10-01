# ADR-0016: Network flows, not packets; headers only

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Packet payloads are private, and HTTPS-encrypted anyway.

## Decision

Capture headers only (small snaplen), aggregate into bidirectional flows, never persist payloads.

## Consequences

Privacy-preserving, cheap to store, honest analytics.

## Alternatives considered

Raw packet capture and storage.
