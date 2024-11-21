FROM node:20.11.1-alpine3.19 AS base

FROM base AS core

WORKDIR /app

COPY yarn.lock .
COPY .yarnrc.yml .
COPY .yarn ./.yarn
COPY package.json .

RUN yarn install

FROM core AS builder

WORKDIR /app

COPY ./ ./

RUN yarn run build

FROM core AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodeuser

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/bin/script .

USER nodeuser

EXPOSE 3000

CMD ["node", "server.js"]
