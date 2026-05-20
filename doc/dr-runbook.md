# Onsective — Disaster Recovery Runbook

> Owner: platform on-call · Last reviewed: 2026-05-17 · Cadence: full restore drill quarterly, tabletop monthly.

This runbook is the source of truth for restoring Onsective from a major outage. It covers Postgres, MinIO, Redis, BullMQ, Elasticsearch, and the application tier. Targets are written for the *launch* footprint (single primary region, 1 read replica, async S3 backup); the multi-region playbook lives in `doc/dr-multi-region.md` once we ship Phase 9.

## RTO / RPO targets

| System          | RTO (time-to-restore) | RPO (data loss) |
| --------------- | --------------------- | --------------- |
| Postgres        | 30 min                | ≤ 5 min (WAL)   |
| MinIO objects   | 60 min                | ≤ 15 min        |
| Redis (cache)   | 5 min (cold start ok) | total           |
| BullMQ queues   | 15 min                | re-enqueue from `payments.captured` / `shipment.updated` |
| Elasticsearch   | 60 min                | rebuildable     |
| App pods        | 5 min (Helm rollout)  | none            |
| Aggregate full restore (worst case) | 90 min | 5 min |

## Severity decision tree

```
Alert fires (PagerDuty)
 │
 ├── Is the api serving 5xx? ──── yes ──► SEV-1 — page commander, follow §1.
 │
 ├── Is checkout failing? ─────── yes ──► SEV-1 — §2 (payments) + §1 (api).
 │
 ├── Search broken? ────────────── yes ──► SEV-2 — §5 (ES rebuild, pg fallback is automatic).
 │
 ├── Push notifications late? ── yes ──► SEV-3 — §6 (notifications).
 │
 └── Cosmetic / no buyer impact ── no ──► SEV-3 — open ticket, normal hours.
```

## 1. Postgres — restore from PITR

We run managed Postgres with continuous WAL archive to S3. Restore steps:

1. **Confirm primary is unreachable**: `pg_isready -h $PRIMARY` from the bastion. If it responds, fail-over isn't needed — investigate the api connection pool first.
2. **Promote the read replica** via the cloud console (or `pg_ctl promote` on self-hosted).
3. **Redirect the api** by patching the `onsective-app-env` Secret:
   ```
   kubectl -n onsective patch secret onsective-app-env \
     --type='json' -p '[{"op":"replace","path":"/data/DATABASE_URL","value":"<base64 new url>"}]'
   kubectl -n onsective rollout restart deploy/onsective-api
   ```
4. **Verify writes**: `psql $NEW_URL -c "INSERT INTO _dr_drill(ts) VALUES (now());"` then rollback the insert.
5. If the replica is also down: restore from the latest base backup + WAL replay.
   - `aws s3 cp s3://onsective-pg-backups/latest.tar.gz - | tar xz -C /var/lib/postgresql/data`
   - Start with `recovery.signal` present so Postgres replays WAL to `recovery_target_time` of your choice (we default to "latest").
6. **Re-create application user roles** if you restored to a fresh cluster (script: `infra/scripts/pg-roles.sh`).
7. **Re-warm**: run `infra/perf/k6/read-mix.js` for 30s to populate the buffer cache.

## 2. Payments — capturing in-flight

If checkout was failing during the outage, some buyers may have a card charged with no order row. Recovery:

1. Pull the Stripe dashboard's `payment_intents` for the affected window.
2. Cross-reference with `Payment` rows: `SELECT id, providerRef FROM "Payment" WHERE created_at >= '...' AND status = 'INITIATED';`
3. For each `payment_intent` that Stripe records as `succeeded` but our table shows `INITIATED`, run the manual reconcile:
   ```
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
     "$API/admin/payments/reconcile/<payment_intent_id>"
   ```
   The handler revalidates the intent, advances the Payment to `CAPTURED`, sets the order to `PAID`, and emits `order.paid` (which kicks off ledger booking + push notification).
4. If a buyer's card was charged but the order doesn't exist at all → refund via Stripe and email the buyer with an apology + a $10 credit (template in `doc/comms/refund-apology.md`).

## 3. MinIO — bucket failover

Buckets are versioned and replicate cross-region every 15 min. To fail over:

1. Confirm the primary endpoint is down: `mc admin info onsective-prod`.
2. Update the api env to point at the replica: `MINIO_ENDPOINT=https://minio-dr.onsective.internal`.
3. `kubectl rollout restart deploy/onsective-api`.
4. The product images and license-key files live in the same bucket — both come back online together.
5. Re-presigning is automatic; existing presigned URLs will fail with 403 until the new endpoint catches up (5-min URL TTL means impact lasts at most 5 min).

## 4. Redis — cold start

Redis is cache-only at launch (rate limiting buckets, idempotency hints). Loss is non-fatal.

1. Spin up a new Redis cluster: `helm install redis bitnami/redis -n onsective -f infra/k8s/helm/redis-values.yaml`.
2. Patch the api env: `REDIS_URL=...`.
3. `kubectl rollout restart deploy/onsective-api`.
4. Expect a 60-90s window of higher Postgres load while caches re-warm.

## 5. Elasticsearch — rebuild

ES is rebuildable from Postgres in ~5 min for a 100k product corpus.

1. Provision a fresh ES cluster (Helm chart in `infra/k8s/helm/opensearch-values.yaml`).
2. Set `ELASTICSEARCH_URL` and rollout the api.
3. Trigger the bootstrap job:
   ```
   kubectl -n onsective create job --from=cronjob/onsective-search-bootstrap onsective-search-bootstrap-once
   ```
4. The api keeps serving via the Postgres fallback the entire time — only the relevance suffers, not availability.

## 6. BullMQ — replaying after outage

BullMQ jobs that were in-flight when the outage hit:

- **Payouts**: `payouts.execute` is idempotent (Stripe transfer is keyed on payoutId; ledger post is keyed on `payout:<id>`). Re-enqueue by running `POST /admin/payouts/run-period` manually.
- **Subscription renewals**: re-fire by querying `SellerSubscription where currentPeriodEnd < now() and status='ACTIVE'` and enqueueing the renewal job.
- **Notifications**: best-effort. Lost pushes are not replayed — buyers can refresh the orders screen to get the same state.

## 7. App pods — blast-radius isolation

If a single deployment is misbehaving:

1. **Scale it down** in isolation: `kubectl -n onsective scale deploy/onsective-buyer --replicas=0` (PodDisruptionBudget allows this because `minAvailable: 1` only applies during voluntary disruptions).
2. The other services keep serving (NetworkPolicy already isolates the data plane).
3. Roll back to the last known good image: `helm rollback onsective <REVISION> -n onsective`.

## 8. First 24h after launch — checklist

- [ ] PagerDuty rotation has 3 engineers, primary + secondary + backup.
- [ ] `pgbouncer` connection pool sized for 5× steady-state RPS.
- [ ] Grafana alerts armed on: `http_request_duration_seconds{le="0.5"}`, `postgres_connections_pct`, `redis_memory_pct`, `nodejs_eventloop_lag_seconds`.
- [ ] Stripe dashboard split-screen with internal `/admin/revenue`.
- [ ] Status page (status.onsective.com) primed with the launch incident template.
- [ ] DR drill rehearsal completed within the last 30 days — sign-off in `doc/dr-drills/2026-q2.md`.

## 9. Contacts

| Role            | Channel               | Escalation lag |
| --------------- | --------------------- | -------------- |
| Platform on-call | PagerDuty `onsective-primary` | 5 min |
| Stripe support   | dashboard.stripe.com → Support | 15 min |
| Database vendor  | tickets.<vendor>.com  | 30 min |
| Founder          | Slack DM              | last resort |
