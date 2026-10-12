export type ConnectionResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_KEY' | 'MODEL_NOT_FOUND' | 'RATE_LIMITED' | 'UNREACHABLE' };

export interface AiProviderAdapter {
  // Verifies that the key works and the model exists, without generating content.
  testConnection(apiKey: string, model: string): Promise<ConnectionResult>;
}
