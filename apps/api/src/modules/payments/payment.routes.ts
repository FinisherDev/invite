import express, { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../lib/logger';
import { handleRefundFailed, handleRefundProcessed } from '../refunds/refund.service';
import { handleChargeSuccess, verifySignature } from './payment.service';

export const webhookRouter = Router();

const envelope = z.object({ event: z.string(), data: z.object({}).passthrough() });
const chargeData = z.object({ reference: z.string(), amount: z.number().int() });
// Field names below are from memory. Verify against Paystack's refund webhook docs before go-live.
const refundData = z.object({ transaction_reference: z.string().optional(), reference: z.string().optional() });

webhookRouter.post('/paystack', express.raw({ type: '*/*', limit: '100kb' }), async (req, res) => {
  const raw = req.body as unknown;
  if (!Buffer.isBuffer(raw) || !verifySignature(raw, req.get('x-paystack-signature'))) {
    res.status(401).end();
    return;
  }
  let parsed;
  try {
    parsed = envelope.parse(JSON.parse(raw.toString('utf8')));
  } catch {
    res.status(400).end();
    return;
  }

  // Unknown or already-handled events return 200 (nothing to retry).
  // A thrown error (e.g. DB down) becomes a 5xx via the error handler, so Paystack retries.
  switch (parsed.event) {
    case 'charge.success': {
      const d = chargeData.parse(parsed.data);
      await handleChargeSuccess(d.reference, d.amount);
      break;
    }
    case 'refund.processed':
    case 'refund.failed': {
      const d = refundData.parse(parsed.data);
      const ref = d.transaction_reference ?? d.reference;
      if (!ref) break;
      if (parsed.event === 'refund.processed') await handleRefundProcessed(ref);
      else await handleRefundFailed(ref);
      break;
    }
    default:
      logger.debug({ event: parsed.event }, 'ignored webhook event');
  }
  res.status(200).end();
});