import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const tokens = new SharedArray('tokens', () => JSON.parse(open('./tokens.json')) as string[]);
const soldOut = new Counter('sold_out_responses');
const BASE = __ENV.BASE_URL;
const EVENT_ID = __ENV.EVENT_ID;
const CATEGORY_ID = __ENV.CATEGORY_ID;

export const options = {
  scenarios: {
    onsale_spike: {
      executor: 'ramping-arrival-rate',   // models arrival rate, not fixed users
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 500,
      maxVUs: 3000,
      stages: [
        { target: 50, duration: '1m' },    // warm-up
        { target: 800, duration: '30s' },  // the spike
        { target: 800, duration: '2m' },   // sustained pressure
        { target: 20, duration: '1m' },    // recovery
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                                // 409 sold-out is expected, so tag it (below)
    'http_req_duration{name:create_order}': ['p(95)<500', 'p(99)<1200'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const token = tokens[Math.floor(Math.random() * tokens.length)];
  const res = http.post(
    `${BASE}/orders`,
    JSON.stringify({
      eventId: EVENT_ID,
      idempotencyKey: uuidv4(),
      items: [{ categoryId: CATEGORY_ID, quantity: 1 + Math.floor(Math.random() * 2) }],
    }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      tags: { name: 'create_order' },
      responseCallback: http.expectedStatuses(201, 409), // 409 = legitimately sold out
    },
  );
  if (res.status === 409) soldOut.add(1);
  check(res, { 'created or sold out': (r) => r.status === 201 || r.status === 409 });
}