import { ok, bad, guard } from '@/lib/api';
import { getAisensyConfig, sendAisensy } from '@/lib/aisensy';

export const runtime = 'nodejs';

// POST /api/settings/aisensy/test  { destination }
// Sends a test WhatsApp message using the saved config + given number.
export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json();
    const destination = (body?.destination || '').toString();
    if (!destination) return bad('Enter a phone number to send the test to.');
    const cfg = await getAisensyConfig();
    try {
      const out = await sendAisensy(cfg, {
        destination,
        templateParams: ['FWAI Tracker', 'Test', 'TEST ALERT', '0'],
      });
      return ok({ sent: true, response: out.slice(0, 300) });
    } catch (e: any) {
      return bad(e.message || 'Failed to send test message.');
    }
  });
}