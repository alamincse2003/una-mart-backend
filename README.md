# UNA Mart API

NestJS + Prisma + PostgreSQL backend for UNA Mart. It replaces the fake
`/api/*` routes in the storefront repo (`una-mart-frontend`) step by step.

Product and architecture reference live in the frontend repo:
`SYSTEM_DESIGN.md` (what to build: entities, lifecycles, API surface) and
`ARCHITECTURE.md` (how: stack decisions, module boundaries).

## Stack

- NestJS 12 (TypeScript, ESM, strict)
- Prisma 7 with the `pg` driver adapter
- PostgreSQL 17 (Docker for local dev)
- Vitest for tests, oxlint for linting

## Run locally

Requires Node 24+ and Docker Desktop (running).

```bash
npm install            # also generates the Prisma client
cp .env.example .env   # first time only
npm run db:up          # starts Postgres on localhost:5433
npm run start:dev      # API on http://localhost:4000
```

Check it: `GET http://localhost:4000/health` returns
`{ "status": "ok", "database": "up" }` (503 if the database is down).

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | API with watch mode |
| `npm run build` / `start:prod` | Production build / run |
| `npm run db:up` / `db:down` | Start / stop the local Postgres container |
| `npm run db:migrate` | Create and apply a migration from `prisma/schema.prisma` |
| `npm run db:generate` | Regenerate the Prisma client after schema changes |
| `npm run db:studio` | Browse the database |
| `npm test` / `test:e2e` | Unit tests / end-to-end (needs the DB running) |
| `npm run lint` | oxlint |

## Layout

```
prisma/schema.prisma     database schema (models added module by module)
prisma.config.ts         Prisma CLI config (reads DATABASE_URL from .env)
src/config/env.ts        environment validation, fails fast at startup
src/prisma/              PrismaService (one shared client)
src/health/              GET /health
src/generated/prisma/    generated client (git-ignored)
```

## Environment

See `.env.example`. Never commit `.env`.
