# ADR-0010: Local open-source LLM via Ollama behind an LLMProvider interface

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Product requirement: AI must be free. No Claude or other paid LLM APIs, and the app must work without any paid AI service.

## Decision

An `LLMProvider` seam with an `OllamaProvider` (REST `/api/chat`, JSON-Schema structured outputs via `format`) and a deterministic `OfflineProvider` fallback. Default model `llama3.2`, configurable per feature.

## Consequences

Zero cost and full privacy (data never leaves the machine or server). Small local models need strict validation, few-shot prompts and fallbacks; latency is higher on CPU.

## Alternatives considered

Paid hosted APIs (Claude, OpenAI): ongoing cost and data leaving the system. Free-text parsing: fragile.
