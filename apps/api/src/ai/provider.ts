export type ConnectionResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_KEY' | 'MODEL_NOT_FOUND' | 'RATE_LIMITED' | 'UNREACHABLE' };

export type GenerateRequest = {
  system: string;
  prompt: string;
  // Ask the model for a JSON document instead of free text.
  json?: boolean;
};

export type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'INVALID_KEY' | 'MODEL_NOT_FOUND' | 'RATE_LIMITED' | 'EMPTY_RESPONSE' | 'UNREACHABLE' };

export interface AiProviderAdapter {
  // Verifies that the key works and the model exists, without generating content.
  testConnection(apiKey: string, model: string): Promise<ConnectionResult>;
  generate(apiKey: string, model: string, request: GenerateRequest): Promise<GenerateResult>;
}
