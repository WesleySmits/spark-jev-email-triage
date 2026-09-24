# Web-server packaging only: no Spark Desktop/CLI or host-session bridge.
# For live mail use the native macOS procedure in docs/runbook.md.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . ./
RUN pnpm build

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# The commit this image was built from, passed as
# `--build-arg APP_COMMIT_SHA=$(git rev-parse HEAD)`. `GET /health` answers
# with it and, while it is unset, answers 503: an image nobody can name is
# not one to send traffic to. It is not a secret and carries no mail.
ARG APP_COMMIT_SHA=""
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}

COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
