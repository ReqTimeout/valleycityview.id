/**
 * Cloudflare Pages Function — receives booking leads.
 *
 * Deployed automatically: Cloudflare Pages picks up the `functions/` directory
 * at the project root and serves `/api/booking` from it, alongside the static
 * `dist/` output.
 *
 * Environment variables (set in the Cloudflare dashboard):
 *   BOOKING_WEBHOOK_URL  optional — POST the lead as JSON to a CRM / Zapier /
 *                        Make.com / Google Apps Script endpoint
 *   BOOKING_WEBHOOK_TOKEN optional — bearer token sent with the webhook
 *   RESEND_API_KEY       optional — send a copy by email via Resend
 *   BOOKING_TO_EMAIL     optional — where the notification goes
 *   KV                    optional — KV namespace binding named KV, used to
 *                        archive leads and to rate-limit by IP
 */

interface Env {
  BOOKING_WEBHOOK_URL?: string;
  BOOKING_WEBHOOK_TOKEN?: string;
  RESEND_API_KEY?: string;
  BOOKING_TO_EMAIL?: string;
  KV?: KVNamespace;
}

/**
 * Minimal Cloudflare Pages types, declared locally so the function compiles
 * without pulling in the full workers-types package.
 */
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

interface EventContext<E> {
  request: Request;
  env: E;
  client: { address?: string };
}

type PagesFunction<E> = (
  ctx: EventContext<E>,
) => Response | Promise<Response>;

interface Lead {
  name: string;
  phone: string;
  email?: string;
  interest?: string;
  message?: string;
  consent?: string;
}

const WINDOW_SECONDS = 60 * 60;
const MAX_PER_WINDOW = 6;

const INTEREST_LABEL: Record<string, string> = {
  booking: 'Booking unit (Rp 5 juta)',
  kpr: 'Simulasi & cicilan KPR',
  visit: 'Jadwal kunjungan ke lokasi',
  unit: 'Ketersediaan unit & denah',
  agent: 'Jadi agen properti',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function clean(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  // Strip control characters, collapse whitespace, cap the length.
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

function normalisePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  if (digits.startsWith('8')) digits = '62' + digits;
  return digits;
}

async function checkRateLimit(ip: string, env: Env): Promise<boolean> {
  if (!env.KV) return true; // No KV bound — skip rather than block leads.
  const key = `rl:${ip}:${Math.floor(Date.now() / 1000 / WINDOW_SECONDS)}`;
  const current = Number((await env.KV.get(key)) ?? '0');
  if (current >= MAX_PER_WINDOW) return false;
  await env.KV.put(key, String(current + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  return true;
}

async function notify(env: Env, lead: Lead & { phone: string; source: string }) {
  const lines = [
    'New Valley Cityview booking lead',
    '',
    `Nama    : ${lead.name}`,
    `WhatsApp: ${lead.phone}`,
    `Email   : ${lead.email || '-'}`,
    `Minat   : ${INTEREST_LABEL[lead.interest ?? ''] ?? lead.interest ?? '-'}`,
    `Catatan : ${lead.message || '-'}`,
    `Sumber  : ${lead.source}`,
    `Waktu   : ${new Date().toISOString()}`,
  ];
  const text = lines.join('\n');

  // 1. Webhook (CRM / automation).
  if (env.BOOKING_WEBHOOK_URL) {
    await fetch(env.BOOKING_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.BOOKING_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${env.BOOKING_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        interest: lead.interest,
        interest_label: INTEREST_LABEL[lead.interest ?? ''] ?? lead.interest,
        message: lead.message,
        source: lead.source,
        submitted_at: new Date().toISOString(),
      }),
    }).catch(() => undefined);
  }

  // 2. Email notification via Resend.
  if (env.RESEND_API_KEY && env.BOOKING_TO_EMAIL) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Valley Cityview <website@valleycity.id>',
        to: [env.BOOKING_TO_EMAIL],
        subject: `Lead baru: ${lead.name} — ${INTEREST_LABEL[lead.interest ?? ''] ?? 'Valley Cityview'}`,
        text,
      }),
    }).catch(() => undefined);
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, client }) => {
  let payload: Partial<Lead> & { company?: string; source?: string };

  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // Honeypot — a filled hidden field means a bot. Pretend it worked.
  if (clean(payload.company)) {
    return json({ ok: true });
  }

  const name = clean(payload.name, 120);
  const phone = clean(payload.phone, 40);
  const email = clean(payload.email, 160);
  const interest = clean(payload.interest, 40);
  const message = clean(payload.message, 1000);
  const source = clean(payload.source, 60) || 'website';

  if (name.length < 2) return json({ ok: false, error: 'invalid_name' }, 400);
  if (!isValidPhone(phone)) return json({ ok: false, error: 'invalid_phone' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!(await checkRateLimit(ip, env))) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  const lead = {
    name,
    phone: normalisePhone(phone),
    email,
    interest,
    message,
    consent: payload.consent ?? '',
    source,
  };

  // Archive in KV when a namespace is bound.
  if (env.KV) {
    await env.KV.put(
      `lead:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`,
      JSON.stringify(lead),
      { expirationTtl: 60 * 60 * 24 * 90 },
    ).catch(() => undefined);
  }

  await notify(env, lead);

  return json({ ok: true });
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
