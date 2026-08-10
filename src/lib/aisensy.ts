import { jsonb, maybeOne, upsertOne } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto';

// AI Sensy (WhatsApp) integration. Config is stored in app_settings under the
// key 'aisensy' as JSON; the API key inside is encrypted at rest.

export interface AisensyConfig {
  enabled: boolean;
  api_url: string; // default AI Sensy Campaign API v2 endpoint
  campaign: string; // approved campaign/template name
  // Optional second approved template for OpenAI low-credit alerts. Same
  // integration and same API key — only the template differs, because the
  // downtime template's 4th variable reads as "minutes" and a credit alert needs
  // to say "% remaining". Blank falls back to `campaign`.
  credits_campaign: string;
  username: string; // display name sent with the message
  threshold_min: number; // minutes down before alerting
  recovery: boolean; // also send a "back up" message
  api_key_enc?: string | null; // encrypted API key (never returned to client)
}

export const AISENSY_DEFAULT_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

export function defaultAisensyConfig(): AisensyConfig {
  return {
    enabled: false,
    api_url: AISENSY_DEFAULT_URL,
    campaign: '',
    credits_campaign: '',
    username: 'FWAI Tracker',
    threshold_min: 15,
    recovery: true,
    api_key_enc: null,
  };
}

export async function getAisensyConfig(): Promise<AisensyConfig> {
  const row = await maybeOne<{ value: AisensyConfig | null }>(
    "select value from app_settings where key = 'aisensy'"
  );
  if (!row?.value) return defaultAisensyConfig();
  return { ...defaultAisensyConfig(), ...row.value };
}

export async function saveAisensyConfig(patch: Partial<AisensyConfig> & { api_key?: string }) {
  const current = await getAisensyConfig();
  const next: AisensyConfig = { ...current, ...patch };
  // If a fresh API key was supplied (not blank), encrypt and store it.
  if (patch.api_key && patch.api_key.trim() && patch.api_key !== '********') {
    next.api_key_enc = encrypt(patch.api_key.trim());
  }
  // never persist the raw key field
  delete (next as any).api_key;
  await upsertOne(
    'app_settings',
    { key: 'aisensy', value: jsonb(next), updated_at: new Date().toISOString() },
    ['key']
  );
  return next;
}

// Strip to digits + country code (AI Sensy wants e.g. 919999999999, no +).
function normalizePhone(p: string): string {
  return (p || '').replace(/[^\d]/g, '');
}

export async function sendAisensy(
  cfg: AisensyConfig,
  opts: { destination: string; userName?: string; templateParams: string[]; campaign?: string }
) {
  if (!cfg.api_key_enc) throw new Error('AI Sensy API key is not set in Settings.');
  // An explicit campaign overrides the default one; falling back keeps every
  // existing caller (which passes none) on exactly the template it used before.
  const campaignName = opts.campaign?.trim() || cfg.campaign;
  if (!campaignName) throw new Error('AI Sensy campaign/template name is not set in Settings.');
  const dest = normalizePhone(opts.destination);
  if (!dest) throw new Error('No valid recipient phone number.');

  const apiKey = decrypt(cfg.api_key_enc);
  const res = await fetch(cfg.api_url || AISENSY_DEFAULT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName,
      destination: dest,
      userName: opts.userName || cfg.username || 'FWAI Tracker',
      templateParams: opts.templateParams,
      source: 'fwai-tracker',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI Sensy error ${res.status}: ${text.slice(0, 300)}`);
  return text;
}