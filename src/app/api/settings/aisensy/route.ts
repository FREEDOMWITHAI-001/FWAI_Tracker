import { ok, guard } from '@/lib/api';
import { getAisensyConfig, saveAisensyConfig } from '@/lib/aisensy';

export const runtime = 'nodejs';

// GET /api/settings/aisensy -> config WITHOUT the API key (just whether it's set)
export async function GET() {
  return guard(async () => {
    const cfg = await getAisensyConfig();
    const { api_key_enc, ...rest } = cfg;
    return ok({ ...rest, has_key: !!api_key_enc });
  });
}

// PUT /api/settings/aisensy -> save config (api_key optional; only stored if provided)
export async function PUT(req: Request) {
  return guard(async () => {
    const body = await req.json();
    const saved = await saveAisensyConfig({
      enabled: !!body.enabled,
      api_url: body.api_url,
      campaign: body.campaign,
      username: body.username,
      threshold_min: Number(body.threshold_min) || 15,
      recovery: !!body.recovery,
      api_key: body.api_key, // encrypted inside saveAisensyConfig if non-blank
    });
    const { api_key_enc, ...rest } = saved;
    return ok({ ...rest, has_key: !!api_key_enc });
  });
}