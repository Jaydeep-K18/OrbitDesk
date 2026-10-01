# ADR-0006: Server-authoritative sessions with a blocks table from day one

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Scheduled starts, extends and multi-block AI plans must stay consistent across devices.

## Decision

The API owns session state and time. Every state payload includes `serverNow`; clients compute an offset. `focus_session_blocks` exists from Phase 1 (one work block in the MVP).

## Consequences

No client timer drift or tampering; Phase 2 multi-block plans need no migration.

## Alternatives considered

Client-side timers: drift, tampering, multi-device inconsistency.
