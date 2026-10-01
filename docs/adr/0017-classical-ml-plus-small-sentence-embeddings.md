# ADR-0017: Classical ML plus small sentence embeddings

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Data volumes are small and predictions must be explainable.

## Decision

Logistic regression and LightGBM with calibration; MiniLM embeddings for task/title similarity; SHAP for explanations.

## Consequences

CPU-only, explainable, trainable on hundreds of sessions.

## Alternatives considered

Deep neural networks: data-starved and opaque.
