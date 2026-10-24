# homeport — Nuxt 3 (Nitro node-server). Build, then run the node server.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci installs exactly the lockfile CI tested. One retry: esbuild's install
# script now and then fails with ETXTBSY (text file busy) in a fresh layer; that
# failed the v2.31.2 image build, and a second run passes.
RUN npm ci --no-audit --no-fund || (echo "npm ci failed, retrying once" && rm -rf node_modules && npm ci --no-audit --no-fund)
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
# docker CLI + compose plugin power the stack manager (HOMEPORT_ALLOW_STACKS).
# They talk to DOCKER_HOST (the socket proxy) — homeport never gets the raw socket.
# git powers git-backed stacks (clone / update-from-repo).
RUN apk add --no-cache docker-cli docker-cli-compose git
ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    NITRO_HOST=0.0.0.0
COPY --from=builder /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
