ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /app
COPY --chown=node:node scripts/owned-mail ./scripts/owned-mail
COPY --chown=node:node src/infrastructure/patient-files/durable-root.ts ./src/infrastructure/patient-files/durable-root.ts
USER node
ENTRYPOINT ["node", "scripts/owned-mail/server.mjs"]
