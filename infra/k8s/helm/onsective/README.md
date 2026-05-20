# Onsective Helm chart

## Layout
- `Chart.yaml` — chart metadata.
- `values.yaml` — defaults (replica counts, HPA targets, image tags).
- `values-production.yaml.example` — sample environment override.
- `templates/` — manifests: api Deployment/Service/HPA/PDB, looped web-apps, ingress, network policy.

## Install
```bash
helm install onsective ./infra/k8s/helm/onsective \
  --namespace onsective --create-namespace \
  -f values-production.yaml
```

## Secrets
The chart references a single Secret named `onsective-app-env` via `envFrom`. Provision it with
External Secrets Operator (or `kubectl create secret generic`) — at minimum:

```
DATABASE_URL
REDIS_URL
JWT_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
MINIO_ENDPOINT
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
LICENSE_KEY_ENC_KEY
AGE_IP_SALT
```

## Hostnames
Each web portal binds to its own subdomain (see `values.yaml`). Ingress class defaults to
`nginx` and includes cert-manager annotations for automatic TLS.

## Scaling levers
- `*.hpa.minReplicas` / `maxReplicas` — capacity floors / ceilings.
- `*.resources.requests` — what the HPA actually scales on.
- `api.env.PAYOUTS_AUTO_RUN` — should remain `"0"` in k8s (BullMQ cron picks up the work
  via the dedicated worker deployment that will land in Phase 8).
