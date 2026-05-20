# Onsective

Premium multi-portal marketplace platform. Four synchronized portals (Buyer, Seller, Admin, Shipping Partner) sharing one event-driven backend, deployable on web + iOS + Android.

This repository is the result of the multi-phase plan in [`doc/master-plan.md`](./doc/master-plan.md). Track build state in [`doc/PROGRESS.md`](./doc/PROGRESS.md).

## Quick start

```bash
# 1. Boot infra (postgres / redis / minio / mailhog)
pnpm infra:up

# 2. Install deps
pnpm install

# 3. Migrate + seed the database
cp .env.example .env
pnpm db:migrate
pnpm db:seed

# 4. Start everything (API on :4000, buyer-web :3000, seller-web :3001, admin-web :3002)
pnpm dev
```

After `pnpm db:seed` you have:

| Role   | Email                 | Password         |
| ------ | --------------------- | ---------------- |
| Admin  | admin@onsective.com   | OnsectiveAdmin1! |
| Seller | seller@onsective.com  | OnsectiveSell1!  |
| Buyer  | buyer@onsective.com   | OnsectiveBuy1!   |

## Layout

```
apps/
  buyer-web/     Next.js 14 storefront         (:3000)
  seller-web/    Next.js 14 seller portal      (:3001)
  admin-web/     Next.js 14 admin portal       (:3002)
  shipping-web/  Phase 2
  mobile/        Phase 7
packages/
  shared-types/  Cross-cutting TS types
  api-client/    Typed fetch wrapper
  ui/            Premium design system (Tailwind + Radix)
services/
  api/           NestJS HTTP + WS + workers    (:4000)
infra/
  docker/        Local compose stack
doc/             Phase docs, debug reports, ADRs
```

## Useful commands

```bash
pnpm dev              # run everything
pnpm build            # build everything
pnpm typecheck        # tsc --noEmit across the monorepo
pnpm db:reset         # drop + recreate DB then re-seed
pnpm infra:logs       # tail compose logs
```

## Resuming a session

The model that built this honors the `doc/PROGRESS.md` checklist as durable state. To pick up where the last session left off, just open Claude Code in this directory and say **"continue"**.
