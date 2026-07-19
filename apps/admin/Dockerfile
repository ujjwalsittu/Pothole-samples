# PotholeCollect admin dashboard — build from the REPO ROOT:
#   docker build -f apps/admin/Dockerfile -t pothole-admin \
#     --build-arg VITE_API_URL=https://api-potholes.threemates.in .
# Vite env is BUILD-time: changing domains/Auth0 requires a rebuild.
FROM node:20-slim AS build

ARG VITE_API_URL=https://api-potholes.threemates.in
ARG VITE_AUTH0_DOMAIN=
ARG VITE_AUTH0_CLIENT_ID=
ARG VITE_AUTH0_AUDIENCE=https://api-potholes.threemates.in

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN npm install --workspace apps/admin --include-workspace-root=false || npm install
COPY packages/shared packages/shared
COPY apps/admin apps/admin

ENV VITE_API_URL=$VITE_API_URL \
    VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN \
    VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID \
    VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE
RUN npm run build --workspace apps/admin

FROM nginx:alpine
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
# SPA fallback
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri /index.html; }\n}\n' \
  > /etc/nginx/conf.d/default.conf
EXPOSE 80
