FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma/schema.prisma prisma/schema.prisma
RUN npm ci --include=dev --no-audit --no-fund

FROM dependencies AS builder

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV CODEXDENTIST_BUILD=1
ENV DEPLOYMENT_MODE=self-hosted
ENV PATIENT_FILE_STORAGE_DRIVER=local
RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --chown=node:node --from=builder /app/package.json /app/package-lock.json /app/prisma.config.ts ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/.next ./.next
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/server.cjs ./server.cjs

RUN mkdir -p /data/patient-files \
  && chown -R node:node /data

USER node
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start -- -H 0.0.0.0 -p 3000"]
