import crypto from 'node:crypto';
import { expect, it } from 'vitest';
import { verifySignature } from '../../src/modules/payments/payment.service';

const body = Buffer.from('{"a":1}');
const good = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(body).digest('hex');

it('accepts only the exact signature and never throws', () => {
  expect(verifySignature(body, good)).toBe(true);
  expect(verifySignature(body, undefined)).toBe(false);
  expect(verifySignature(body, 'short')).toBe(false); // used to throw RangeError
  expect(verifySignature(body, 'a'.repeat(good.length))).toBe(false);
  expect(verifySignature(Buffer.from('{"a":2}'), good)).toBe(false);
});