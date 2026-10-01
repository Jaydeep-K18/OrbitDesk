# ADR-0018: Docker Compose on a single VM for production

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Target scale is small, and operations must be manageable by one developer.

## Decision

One VM running Docker Compose behind Caddy, with a documented scale path to managed services.

## Consequences

Low cost and simple operations; the single point of failure is mitigated by backups and runbooks.

## Alternatives considered

Kubernetes: overhead without a matching benefit.
