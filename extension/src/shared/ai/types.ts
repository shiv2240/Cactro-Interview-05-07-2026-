import type { AIAction, AIProviderId, AIResponseEnvelope } from "../types";

export interface GenerateOptions {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Override provider latency budget (ms). Used by Gemini Nano. */
  timeoutMs?: number;
}

export interface StreamChunk {
  text: string;
  done: boolean;
}

export interface AIProvider {
  readonly id: AIProviderId;
  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;
  generate(options: GenerateOptions): Promise<string>;
  stream(options: GenerateOptions): AsyncGenerator<StreamChunk, void, unknown>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
  dispose(): Promise<void>;
}

export interface AIRequestContext {
  action: AIAction;
  text: string;
  pageTitle?: string;
  url?: string;
  workspaceLabel?: string;
  summaryStyle?: string;
  tone?: string;
}

export type { AIResponseEnvelope, AIAction };
