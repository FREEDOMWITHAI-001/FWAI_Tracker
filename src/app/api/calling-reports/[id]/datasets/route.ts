import { createHash } from 'node:crypto';
import { insertOne, jsonb, maybeOne, sql, updateById } from '@/lib/db';
import { ok, bad, guard } from '@/lib/api';
import { detectShape, extractRows, headerSignature, parseFile } from '@/lib/reports/parse';
import { suggestMapping } from '@/lib/reports/mapping';
import { insertRows, recallMapping } from '@/lib/reports/store';
import { INPUT_ROLES, type InputRole } from '@/lib/reports/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
type Ctx = { params: Promise<{ id: string }> };

// GET /api/calling-reports/[id]/datasets
export async function GET(_req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;
    const rows = await sql('select * from report_datasets where report_id = $1 order by created_at asc', [id]);
    return ok(rows);
  });
}

// POST /api/calling-reports/[id]/datasets   (multipart/form-data)
//   file    the CSV / XLSX
//   role    leads | calls | attendance | sales | cost | comeback
//   options JSON string, e.g. {"call_mode":"manual"}
//   force   "1" to accept a byte-identical re-upload
//
// Detects the physical shape, extracts the rows, keeps them verbatim as jsonb,
// and returns a suggested column mapping for the operator to confirm.
export async function POST(req: Request, { params }: Ctx) {
  return guard(async () => {
    const { id } = await params;

    const report = await maybeOne<{ id: string; client_id: string }>(
      'select id, client_id from calling_reports where id = $1',
      [id]
    );
    if (!report) return bad('Report not found', 404);

    const form = await req.formData();
    const file = form.get('file');
    const role = String(form.get('role') ?? '') as InputRole;
    const force = String(form.get('force') ?? '') === '1';
    if (!(file instanceof File)) return bad('file is required (multipart/form-data)');
    if (!INPUT_ROLES.includes(role)) return bad(`role must be one of: ${INPUT_ROLES.join(', ')}`);
    if (file.size > MAX_BYTES) return bad(`File is ${(file.size / 1e6).toFixed(1)} MB — the limit is 25 MB.`);

    let options: Record<string, unknown> = {};
    const rawOptions = form.get('options');
    if (typeof rawOptions === 'string' && rawOptions.trim()) {
      try {
        options = JSON.parse(rawOptions);
      } catch {
        return bad('options must be valid JSON');
      }
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const hash = createHash('sha256').update(buf).digest('hex');

    // Duplicate upload: the same bytes already sit in this report.
    if (!force) {
      const dupe = await maybeOne<{ id: string; filename: string; role: string }>(
        'select id, filename, role from report_datasets where report_id = $1 and content_hash = $2',
        [id, hash]
      );
      if (dupe) {
        return bad(
          `This exact file is already attached as "${dupe.filename}" (${dupe.role}). ` +
            'Re-send with force=1 if you really want a second copy — otherwise every count in it would be doubled.',
          409
        );
      }
    }

    const parsed = await parseFile(file.name, buf);
    if (!parsed.grid.length) return bad('The file contained no rows.');
    const detection = detectShape(parsed.grid, parsed.kind);
    const rows = extractRows(parsed.grid, detection);
    if (!rows.main.length) return bad('No data rows were found below the detected header.');

    // Suggest, then let a saved mapping for this exact header layout win.
    const suggestion = suggestMapping(role, detection.headers);
    const signature = headerSignature(detection.headers);
    const remembered = await recallMapping(report.client_id, role, signature);
    const mapping = remembered ? { ...suggestion.mapping, ...remembered.mapping } : suggestion.mapping;
    const mergedOptions = remembered ? { ...remembered.options, ...options } : options;
    const notes = [...detection.notes];
    if (remembered) notes.push('A saved column mapping for this client and file layout was applied automatically.');

    const ds = await insertOne<any>('report_datasets', {
      client_id: report.client_id,
      report_id: id,
      role,
      source: 'upload',
      filename: file.name,
      shape: detection.shape,
      content_hash: hash,
      headers: jsonb(detection.headers),
      row_count: rows.main.length,
      mapping: jsonb(mapping),
      mapping_confidence: jsonb(suggestion.confidence),
      options: jsonb(mergedOptions),
      detect_notes: jsonb(notes),
    });

    await insertRows(ds.id, rows.main, rows.session);
    await updateById('calling_reports', id, { status: 'draft', updated_at: new Date().toISOString() });

    return ok(
      {
        ...ds,
        header_signature: signature,
        auto_mapped: !!remembered,
        unmapped_required: suggestion.unmapped_required,
        preview: rows.main.slice(0, 20),
        session_preview: rows.session.slice(0, 5),
      },
      201
    );
  });
}
