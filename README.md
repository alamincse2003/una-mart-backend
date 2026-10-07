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
npm run db:up          # starts Postgres on localhost:55432
npm run db:migrate     # creates the tables
npm run db:seed        # loads the Phase 1 catalog (safe to re-run)
npm run admin:create -- --phone 017XXXXXXXX --name "Your Name"   # first admin
npm run start:dev      # API on http://localhost:4000
```

API docs (Swagger): http://localhost:4000/docs — JSON at `/docs-json`.

**OTP codes in development:** no SMS gateway yet, so codes are printed in
the API log (`[SMS] to +8801…: Your UNA Mart code is 123456`) and returned
as `devCode` in the response. Production refuses to start with
`SMS_PROVIDER=console`.

## Endpoints

Everything except `/health` is under `/v1`. Full shapes in Swagger.

### Storefront

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | 200 when the database answers, 503 otherwise |
| GET | `/v1/categories` | Active categories as a tree |
| GET | `/v1/products` | `category` (slug or comma-separated slugs, includes subcategories), `q`, `ids`, `price_min`, `price_max`, `rating_min`, `in_stock`, `on_sale`, `sort` (`featured`, `newest`, `price-asc`, `price-desc`, `rating`), `page`, `pageSize` (max 100). Returns `{ items, page, pageSize, total, totalPages }`; each item has `variantId` (cheapest active variant) and `stockQty` |
| GET | `/v1/products/:slug` | Detail with variants, images and category path; 404 if not active |
| GET | `/v1/delivery-zones` | Active zones with fee and ETA |
| GET | `/v1/cart` | Current cart: the user's when logged in, else the `una_cart` guest cookie's |
| POST | `/v1/cart/items` | `{ variantId, quantity }` — adds, capped at stock and 50 per line |
| PATCH | `/v1/cart/items/:id` | `{ quantity }` |
| DELETE | `/v1/cart/items/:id` | Remove a line |
| POST | `/v1/orders` | COD checkout from the cart: `{ customerName, phone, email?, address { line1, area?, city }, deliveryZone, paymentMethod, note?, otpCode? }`. Re-prices on the server, applies the COD risk rules, takes stock, empties the cart. 10/min |
| GET | `/v1/orders` | My orders (login) |
| GET | `/v1/orders/:number` | Owner when logged in, or guest with `?phone=` (same 404 for any mismatch). 20/min |
| POST | `/v1/orders/:number/cancel` | Same access rule; while pending / confirmed; restocks. 20/min |

### Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/auth/otp/request` | `{ phone, purpose: login \| checkout }` → `{ expiresInSeconds, devCode? }`. 6 digits, 5 min, 5 tries, max 3 sends per phone per 15 min. 5/min per IP |
| POST | `/v1/auth/otp/verify` | `{ phone, code }` → customer login (account created on first login), session cookie, guest cart merged. 10/min |
| POST | `/v1/auth/admin/login` | `{ phone, password }` → sends an admin OTP. 5/min |
| POST | `/v1/auth/admin/verify` | `{ phone, code }` → 12-hour admin session |
| POST | `/v1/auth/logout` | Ends the session |
| GET / PATCH | `/v1/auth/me` | Current user; update `{ name, email }` |

Sessions live in Postgres; the browser holds only the `una_session`
httpOnly cookie (customers 30 days, admins 12 hours). Writes that carry
cookies from an origin not in `WEB_ORIGIN` get 403 `BAD_ORIGIN`. Admin
routes need the admin role **and** a session from the password + OTP login.

### Admin (admin session; every write goes to the audit log)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/admin/stats` | Today's orders and value (Dhaka time), pending confirmations, status counts, low stock (≤ 5) |
| GET | `/v1/admin/orders` | `status`, `paymentMethod`, `q` (number / phone / name), `from`, `to`, `page`, `pageSize` |
| GET | `/v1/admin/orders/:number` | Detail with timeline (who did what), payments, phone flag, allowed next statuses |
| POST | `/v1/admin/orders/:number/transition` | `{ to, note? }` — lifecycle moves only |
| PATCH | `/v1/admin/orders/:number` | `{ adminNote }` |
| GET / POST | `/v1/admin/products` | List (any status, `q`, `status`, `categoryId`); create with first variant, opening stock and image URLs |
| GET / PATCH | `/v1/admin/products/:id` | Detail incl. inactive variants; edit (images list is replaced) |
| POST | `/v1/admin/products/:id/variants` | Add a variant |
| PATCH | `/v1/admin/variants/:id` | Price, was-price, SKU, options, active — not stock |
| POST | `/v1/admin/variants/:id/stock` | `{ delta, reason: restock \| adjustment, note? }` — never below 0, recorded in the stock ledger |
| GET / POST | `/v1/admin/categories` | Flat list incl. hidden, with product counts; create |
| PATCH | `/v1/admin/categories/:id` | Rename, move (no cycles), hide |
| GET / PATCH | `/v1/admin/delivery-zones[/:code]` | Fees, ETA, on/off |
| GET / PATCH | `/v1/admin/phone-flags[/:phone]` | COD refusal counts; block / unblock |
| GET | `/v1/admin/audit-log` | `entityType`, `entityId`, `page` |

All money is integer **poisha** (৳1,990 = `199000`). Price and stock live on
product variants; list items show the cheapest active variant.

**Payments:** cash on delivery only for now. `bkash` / `nagad` / `card`
return 422 `PAYMENT_METHOD_UNAVAILABLE`. When an order is marked delivered,
its COD payment is marked paid.

**COD risk rules** (checkout answers 428 `OTP_REQUIRED`; the client sends a
`purpose: checkout` OTP and retries with `otpCode`):
- blocked phone → 422 `COD_BLOCKED`;
- first-time phone (no earlier verified or delivered order) → OTP;
- 2 or more refused COD deliveries → OTP;
- total above `COD_OTP_THRESHOLD` (default ৳10,000) → OTP;
- logged in with the same verified phone → no OTP needed.

OTP-verified orders are confirmed automatically; others wait for a
confirmation call. `COD_MAX_ORDER_TOTAL` is an optional hard cap. No order
SMS is sent yet.

**Errors** always look like `{ "statusCode": 409, "code": "OUT_OF_STOCK",
"message": "Only 1 left of …" }`. Main codes: `VALIDATION_FAILED`,
`NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `BAD_ORIGIN`, `CART_EMPTY`,
`OUT_OF_STOCK`, `ITEM_UNAVAILABLE`, `INVALID_PHONE`,
`PAYMENT_METHOD_UNAVAILABLE`, `COD_BLOCKED`, `OTP_REQUIRED`, `OTP_INVALID`,
`OTP_LOCKED`, `OTP_RATE_LIMITED`, `INVALID_CREDENTIALS`,
`COD_LIMIT_EXCEEDED`, `INVALID_TRANSITION`, `STOCK_NEGATIVE`, `SLUG_TAKEN`,
`SKU_TAKEN`, `INVALID_PRICE`, `CATEGORY_CYCLE`, `INTERNAL_ERROR`.

Check it: `GET http://localhost:4000/health` returns
`{ "status": "ok", "database": "up" }` (503 if the database is down).

## Scripts

| Script | What it does |
|---|---|
| `npm run start:dev` | API with watch mode |
| `npm run build` / `start:prod` | Production build / run |
| `npm run db:up` / `db:down` | Start / stop the local Postgres container |
| `npm run db:migrate` | Create and apply a migration from `prisma/schema.prisma` |
| `npm run db:seed` | Load `prisma/seed-data.json` (snapshot of the storefront's fake catalog) |
| `npm run db:reset` | Drop everything, re-run migrations and the seed |
| `npm run db:generate` | Regenerate the Prisma client after schema changes |
| `npm run db:studio` | Browse the database |
| `npm run admin:create -- --phone … --name …` | Create an admin, or reset an admin's password (hidden prompt; ends their sessions) |
| `npm test` / `test:e2e` | Unit tests / end-to-end (needs the DB running; cleans up after itself) |
| `npm run lint` | oxlint |

## Layout

```
prisma/schema.prisma     database schema (models added module by module)
prisma.config.ts         Prisma CLI config (reads DATABASE_URL from .env)
src/config/env.ts        environment validation, fails fast at startup
src/prisma/              PrismaService (one shared client)
src/health/              GET /health
src/common/              error shape, phone normalizer, helpers
src/catalog/             categories + products read API
src/inventory/           the only code that changes stock (+ StockMovement ledger)
src/shipping/            delivery zones and fee rule
src/notifications/       SMS sender (console in dev)
src/auth/                OTP, sessions, global SessionGuard (@Auth, @AdminOnly)
src/cart/                guest + user carts, merge at login
src/orders/              checkout + COD risk rules, lookup, cancel, status transitions
src/admin/               admin API + audit log
prisma/seed.ts           seed script; data in prisma/seed-data.json
scripts/create-admin.ts  admin account CLI
src/generated/prisma/    generated client (git-ignored)
```

## Environment

See `.env.example`. Never commit `.env`. `OTP_SECRET` must be 32+ random
characters (the example shows how to generate one).
