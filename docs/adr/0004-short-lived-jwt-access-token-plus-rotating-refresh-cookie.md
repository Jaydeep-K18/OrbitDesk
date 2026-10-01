# ADR-0004: Short-lived JWT access token plus rotating refresh cookie

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

The SPA, extension and collector all need authenticated API access; long sessions must be revocable.

## Decision

15-minute EdDSA JWT access tokens held in memory; opaque refresh tokens stored hashed, rotated on every use with family reuse detection, delivered to the web app in a `__Host-` HttpOnly SameSite=Strict cookie.

## Consequences

Refresh tokens are unreachable from JavaScript; stolen refresh tokens are detected on reuse.

## Alternatives considered

Tokens in localStorage (XSS-exfiltratable); pure server sessions (awkward for the extension and collector).
