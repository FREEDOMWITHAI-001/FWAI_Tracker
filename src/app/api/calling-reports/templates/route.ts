import { insertOne } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { loadTemplates } from '@/lib/reports/store';
import { checkTemplate, visibleTemplates } from '@/lib/reports/templates';
import type { BlockId, InputRole, LensId } from '@/lib/reports/types';

export const runtime = 'nodejs';

const LENS_IDS: LensId[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'];
const BLOCK_IDS: BlockId[] = ['scorecard', 'funnel', 'per_webinar', 'who_bought', 'roi'];

// GET /api/calling-reports/templates?client_id=&roles=leads,calls
// Client-specific templates override globals of the same key. `roles` marks
// which templates are runnable with what has been uploaded so far.
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const roles = (url.searchParams.get('roles') ?? '').split(',').filter(Boolean) as InputRole[];
    const templates = visibleTemplates(await loadTemplates(clientId));
    return ok(templates.map((t) => ({ ...t, validity: checkTemplate(t, roles) })));
  });
}

// POST /api/calling-reports/templates
//   { client_id?, key, name, description?, lenses[], blocks[], requires[],
//     optional_roles[], primary_lens? }
//
// This is how a new report format is added: no engine change, no deploy. The
// engine already knows every lens and every block; a template only picks them.
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    if (!body?.key || !body?.name) return bad('key and name are required');
    const lenses = (body.lenses ?? []) as LensId[];
    const blocks = (body.blocks ?? []) as BlockId[];
    const badLens = lenses.filter((l) => !LENS_IDS.includes(l));
    const badBlock = blocks.filter((b) => !BLOCK_IDS.includes(b));
    if (badLens.length) return bad(`Unknown lens id(s): ${badLens.join(', ')}. Valid: ${LENS_IDS.join(', ')}`);
    if (badBlock.length) return bad(`Unknown block id(s): ${badBlock.join(', ')}. Valid: ${BLOCK_IDS.join(', ')}`);
    if (body.primary_lens && !lenses.includes(body.primary_lens))
      return bad('primary_lens must be one of the template’s own lenses');

    // lenses/blocks/requires/optional_roles are text[] columns, so the JS
    // arrays go straight through as Postgres arrays (no jsonb() here).
    const data = await insertOne('report_templates', {
      client_id: body.client_id ?? null,
      key: body.key,
      name: body.name,
      description: body.description ?? null,
      lenses,
      blocks: blocks.length ? blocks : BLOCK_IDS,
      requires: body.requires ?? [],
      optional_roles: body.optional_roles ?? [],
      primary_lens: body.primary_lens ?? lenses[0] ?? null,
      is_builtin: false,
      sort_order: body.sort_order ?? 200,
    });
    return ok(data, 201);
  });
}
