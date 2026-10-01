# ADR-0008: WXT for the Chrome extension

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

MV3 extensions need bundling, HMR, Shadow-DOM content-script UI and test utilities.

## Decision

WXT (Vite-based), pinned to 0.20.11 while local Node is 20.18 (newer WXT pulls Vite 8, which needs Node 20.19+).

## Consequences

Less glue code; `fakeBrowser` for unit tests.

## Alternatives considered

CRXJS or a hand-rolled build: more glue.
