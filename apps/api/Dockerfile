# PotholeCollect API — build from the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t pothole-api .
FROM node:20-slim

# ffmpeg for frame extraction / thumbnails (system binary wins over the
# bundled ffmpeg-static, and always works on slim/debian).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace install: shared package + api only (admin/mobile not needed).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm install --workspace apps/api --include-workspace-root=false || npm install

COPY packages/shared packages/shared
COPY apps/api apps/api

ENV NODE_ENV=production PORT=4000
EXPOSE 4000

# Migrations are idempotent — run on every container start.
CMD ["sh", "-c", "npm run migrate --workspace apps/api && npm run start --workspace apps/api"]
