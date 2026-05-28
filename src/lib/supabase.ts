import { createClient } from '@supabase/supabase-js';

// Server-only Supabase client using the service role key.
// This must never be imported into a client component — the service role key
// bypasses Row Level Security and is read from a non-public env var.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  // Thrown lazily at request time so `next build` doesn't fail without env vars.
  console.warn(
    '[fwai-tracker] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Copy .env.example to .env.local and fill them in.'
  );
}

export function supabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.'
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
