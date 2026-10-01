# ADR-0009: Layered activity classification: rules, then LLM, then ML

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Context-aware classification is required from the start, but no training data exists yet.

## Decision

A deterministic precedence pipeline (feedback, blocked, planned, overrides, rule matrix), then an LLM for ambiguous segments (Phase 2), then an ML model with LLM fallback (Phase 6).

## Consequences

Useful behaviour ships immediately; user relabels become gold training labels.

## Alternatives considered

ML-first: impossible without data.
