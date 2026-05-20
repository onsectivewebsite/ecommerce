// k6 inventory-burst scenario.
//
// Simulates a flash-sale write storm: 10 seller users PATCHing inventory on
// 100 variants for 30s. The interesting metric here is contention behavior on
// the variant + inventory_reservation tables, not raw RPS.
//
// Run with:
//   TARGET=https://api.staging.onsective.com SELLER_TOKENS=infra/perf/k6/seller-tokens.csv \
//   k6 run infra/perf/k6/inventory-burst.js

import http from 'k6/http';
import { check, group } from 'k6';
import { SharedArray } from 'k6/data';
import { open } from 'k6/experimental/fs';

const TARGET = __ENV.TARGET || 'http://localhost:4000';
const TOKENS_PATH = __ENV.SELLER_TOKENS || './seller-tokens.csv';

const tokens = new SharedArray('tokens', () => {
  const raw = open(TOKENS_PATH);
  return raw.trim().split(/\r?\n/).slice(1).map((l) => {
    const [token, variantId] = l.split(',');
    return { token, variantId };
  });
});

export const options = {
  scenarios: {
    flash: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: 3000,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed:   ['rate<0.02'],
    http_req_duration: ['p(95)<400'],
  },
};

export default function () {
  const t = tokens[Math.floor(Math.random() * tokens.length)];
  group('inventory update', () => {
    const newQty = Math.floor(Math.random() * 50);
    const res = http.patch(`${TARGET}/seller/products/variants/${t.variantId}`, JSON.stringify({ inventoryQty: newQty }), {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
    });
    check(res, { 'accepted': (r) => r.status < 500 });
  });
}
