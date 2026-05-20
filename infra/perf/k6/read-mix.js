// k6 read-mix scenario.
//
// Hits the cacheable buyer surface: home product list, category browse,
// search, and PDP. Targets: 200 RPS for 1m, p95 < 200ms.
//
// Run with:
//   TARGET=https://api.staging.onsective.com k6 run infra/perf/k6/read-mix.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const TARGET = __ENV.TARGET || 'http://localhost:4000';

export const options = {
  scenarios: {
    readers: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_failed:   ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
  },
};

const errorRate = new Rate('endpoint_errors');

const SAMPLE_QUERIES = ['shirt', 'lamp', 'book', 'cap', 'phone case'];
const SAMPLE_CATEGORIES = ['apparel', 'home', 'electronics', 'beauty', 'books'];

export default function () {
  group('home: product list', () => {
    const res = http.get(`${TARGET}/catalog/products?pageSize=24`);
    check(res, { '200': (r) => r.status === 200 }) || errorRate.add(1);
  });

  group('category', () => {
    const cat = SAMPLE_CATEGORIES[Math.floor(Math.random() * SAMPLE_CATEGORIES.length)];
    const res = http.get(`${TARGET}/catalog/products?category=${cat}&pageSize=24`);
    check(res, { '200': (r) => r.status === 200 }) || errorRate.add(1);
  });

  group('search', () => {
    const q = SAMPLE_QUERIES[Math.floor(Math.random() * SAMPLE_QUERIES.length)];
    const res = http.get(`${TARGET}/search?query=${encodeURIComponent(q)}`);
    check(res, { '200': (r) => r.status === 200 }) || errorRate.add(1);
  });

  sleep(Math.random() * 0.4);
}
