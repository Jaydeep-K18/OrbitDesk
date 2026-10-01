# ADR-0005: Device pairing for the extension and collector

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Typing passwords into an extension is risky and clumsy; devices must be individually revocable.

## Decision

The dashboard issues a one-time, 2-minute pairing code; the extension (via `externally_connectable`) or the collector exchanges it for a scoped device token pair.

## Consequences

Per-device scopes (`activity:write`, `session:read`, `network:write`) and revocation from Settings > Devices.

## Alternatives considered

The extension reading website cookies: brittle and over-privileged.
