# ADR-0007: declarativeNetRequest dynamic rules redirecting to blocked.html

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

MV3 forbids blocking webRequest for normal extensions, and the service worker can be asleep.

## Decision

Per-domain DNR redirect rules (`requestDomains` covers subdomains) to an extension page that also records the blocked attempt.

## Consequences

Blocking is enforced by the browser even when the service worker is not running.

## Alternatives considered

Blocking webRequest (not allowed in MV3); content-script hiding (flash of content, bypassable).
