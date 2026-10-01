/**
 * Architectural seams (ROADMAP §2 principle 7). Later phases plug in new
 * implementations without touching feature code:
 *   EventBus     — in-process (P1) → Kafka (P4)
 *   LLMProvider  — Ollama / offline (P2)
 *   Classifier   — rules (P1) → rules+LLM (P2) → rules+ML+LLM (P6)
 *   Cache        — in-memory → Redis (P3)
 */

export interface DomainEvent<TPayload = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  userId: string;
  sessionId?: string;
  deviceId?: string;
  payload: TPayload;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => Promise<void> | void;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T = unknown>(eventType: string, handler: EventHandler<T>): () => void;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface StructuredRequest {
  feature: 'planner' | 'insights' | 'classifier';
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** JSON Schema for the expected output (derived from a Zod schema). */
  jsonSchema: Record<string, unknown>;
}

export interface StructuredResult {
  raw: unknown;
  model: string;
  usage: LLMUsage;
  latencyMs: number;
}

export interface LLMProvider {
  readonly name: string;
  generateStructured(request: StructuredRequest): Promise<StructuredResult>;
}

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}
