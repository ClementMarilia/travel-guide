import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchModels, pickModel, recommendedModel } from './models';

/** Modelo escolhido pela pessoa (se ainda existir na lista) ou o recomendado. */
export async function resolveUserModel(db: SupabaseClient, userId: string, apiKey: string): Promise<string> {
  const { data } = await db.from('profiles').select('ai_model').eq('id', userId).maybeSingle();
  const allowed = await fetchModels(apiKey).catch(() => []);
  return pickModel(data?.ai_model, allowed, recommendedModel());
}
