import { env } from '../config/env';

export class ProviderError extends Error {}

async function call<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const res = await fetch(`${env.PAYSTACK_BASE_URL}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!res.ok || !json?.status) throw new ProviderError(json?.message ?? `Paystack responded ${res.status}`);
  return json.data as T;
}

export const paystack = {
  async initialize(i: { email: string; amountMinor: number; currency: string; reference: string }) {
    const d = await call<{ authorization_url: string }>('/transaction/initialize', {
      method: 'POST',
      body: { email: i.email, amount: i.amountMinor, currency: i.currency, reference: i.reference },
    });
    return { authorizationUrl: d.authorization_url };
  },
  async verify(reference: string) {
    const d = await call<{ status: string; amount: number }>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    );
    return { status: d.status, amountMinor: d.amount };
  },
  async refund(i: { reference: string; amountMinor: number }) {
    const d = await call<{ id?: number | string }>('/refund', {
      method: 'POST',
      body: { transaction: i.reference, amount: i.amountMinor },
    });
    return { providerRef: d.id != null ? String(d.id) : null };
  },
};