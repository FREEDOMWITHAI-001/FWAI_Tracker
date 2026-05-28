import { NextResponse } from 'next/server';

export function ok(data: unknown, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Wrap a handler so thrown errors become clean 500s with a message.
export async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return bad(msg, 500);
  }
}
