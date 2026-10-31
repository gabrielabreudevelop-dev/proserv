# ProServ — imagem de produção (Next.js standalone).
# Build:   docker build -t proserv .
# Migrar:  docker run --rm -e DATABASE_URL=... proserv npx prisma migrate deploy
# Rodar:   docker run -p 3000:3000 --env-file .env.production proserv

FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# Instala sem scripts (o client é gerado no estágio de build)
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL só é lida pelo prisma.config; qualquer valor serve para gerar o client.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# Servidor autocontido + estáticos
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Migrações e CLI do Prisma para `prisma migrate deploy` e o script create-admin
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/prisma.config.ts ./prisma.config.ts
COPY --from=deps --chown=app:app /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps --chown=app:app /app/node_modules/dotenv ./node_modules/dotenv
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
