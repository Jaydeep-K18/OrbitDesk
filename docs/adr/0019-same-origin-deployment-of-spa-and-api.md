# ADR-0019: Same-origin deployment of SPA and API

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Cookies and CORS get complicated across origins.

## Decision

Caddy serves the SPA and reverse-proxies `/api` and `/socket.io` on one host; Vite proxies the same paths in development.

## Consequences

Simple cookie security and no CORS for the dashboard.

## Alternatives considered

A separate API domain: third-party cookie and CORS complexity.
