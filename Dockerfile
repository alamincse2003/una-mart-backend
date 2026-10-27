# UNA Mart API — production image.
# Built by GitHub Actions and pulled by the VPS (deploy/README in VPS_GUIDE.md);
# the server never builds anything itself.

# ---- build: install everything, generate the Prisma client, compile ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# postinstall runs `prisma generate`. It never connects, but prisma.config.ts
# requires DATABASE_URL to be set — a placeholder for this build step only.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime: production dependencies + compiled app ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Runtime deps include the prisma CLI and tsx on purpose: the server runs
# `prisma migrate deploy`, the seed and scripts/create-admin.ts from this image.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
# Install scripts must run: they download Prisma's schema engine (used by
# `migrate deploy`) for this exact platform at build time, not on the server.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build     npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# Sources the TypeScript tools (seed, create-admin) import, incl. the generated client.
COPY --from=build /app/src ./src
COPY scripts ./scripts

USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
