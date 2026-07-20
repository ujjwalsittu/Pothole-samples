#!/usr/bin/env bash
# fix-auth-deploy.sh — align Auth0 + server config for PotholeCollect.
#
# What it does (two independent parts):
#
#   1. Auth0 tenant provisioning (runs from ANY machine, needs AUTH0_MGMT_TOKEN):
#        - creates the custom API (resource server) https://<API_DOMAIN>
#          with RS256 + offline access, if missing
#        - creates + deploys a post-login Action that copies the user's email
#          into the access token as the `https://pothole/email` claim, and
#          binds it to the login flow (idempotent, keeps existing bindings)
#        - adds the mobile app's callback URLs to Allowed Logout URLs
#      Get a token: Auth0 Dashboard → Applications → APIs →
#      Auth0 Management API → "API Explorer" tab → copy the test token.
#
#   2. Server env update + rebuild (run ON the docker-compose host):
#        - ensures AUTH0_DOMAIN / API_DOMAIN are set in .env.production
#          (docker-compose.prod.yml derives AUTH0_AUDIENCE + the admin's
#          VITE_AUTH0_AUDIENCE from API_DOMAIN, so no audience var is needed)
#        - rebuilds/restarts the api + admin containers
#        - health-checks the API
#
# Usage:
#   AUTH0_MGMT_TOKEN=eyJ... ./tools/fix-auth-deploy.sh            # both parts
#   AUTH0_MGMT_TOKEN=eyJ... ./tools/fix-auth-deploy.sh --auth0-only
#   ./tools/fix-auth-deploy.sh --deploy-only                      # server only
set -euo pipefail

# ----------------------------- configuration -------------------------------
API_DOMAIN="${API_DOMAIN:-api-potholes.threemates.in}"
AUTH0_DOMAIN="${AUTH0_DOMAIN:-tmv.jp.auth0.com}"
AUDIENCE="https://${API_DOMAIN}"
NATIVE_CLIENT_ID="${NATIVE_CLIENT_ID:-qDn3qug1tBxuBDKdAjJhJxBGl60MQhQ4}"
BUNDLE_ID="com.threemates.potholecollect"
CLAIM_NS="https://pothole/email"
ACTION_NAME="Add email to access token"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.production}"
COMPOSE_FILE="$REPO_DIR/docker-compose.prod.yml"

DO_AUTH0=1; DO_DEPLOY=1
case "${1:-}" in
  --auth0-only)  DO_DEPLOY=0 ;;
  --deploy-only) DO_AUTH0=0 ;;
  "") ;;
  *) echo "usage: $0 [--auth0-only|--deploy-only]"; exit 2 ;;
esac

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------- part 1: Auth0 tenant ----------------------------
mgmt() { # method path [json-body]
  local method="$1" path="$2" body="${3:-}"
  curl -sS -X "$method" "https://${AUTH0_DOMAIN}/api/v2${path}" \
    -H "Authorization: Bearer ${AUTH0_MGMT_TOKEN}" \
    -H 'Content-Type: application/json' \
    ${body:+--data "$body"}
}

provision_auth0() {
  command -v jq >/dev/null || die "jq is required (brew install jq / apt install jq)"
  [ -n "${AUTH0_MGMT_TOKEN:-}" ] || die "AUTH0_MGMT_TOKEN is not set (see header comment)"

  log "Checking Management API access on ${AUTH0_DOMAIN}"
  mgmt GET "/resource-servers?per_page=1" | jq -e 'type=="array"' >/dev/null \
    || die "Management API call failed — token invalid/expired or missing scopes"

  # -- custom API (resource server) --
  local existing
  existing=$(mgmt GET "/resource-servers" | jq -r --arg id "$AUDIENCE" '.[] | select(.identifier==$id) | .id')
  if [ -n "$existing" ]; then
    log "API '${AUDIENCE}' already exists — ensuring offline access is on"
    mgmt PATCH "/resource-servers/${existing}" \
      '{"allow_offline_access":true,"signing_alg":"RS256"}' >/dev/null
  else
    log "Creating API '${AUDIENCE}' (RS256, offline access)"
    mgmt POST "/resource-servers" "$(jq -n --arg id "$AUDIENCE" \
      '{name:"PotholeCollect API",identifier:$id,signing_alg:"RS256",allow_offline_access:true}')" \
      | jq -e '.identifier' >/dev/null || die "failed to create the API"
  fi

  # -- post-login action --
  local action_code action_id
  action_code='exports.onExecutePostLogin = async (event, api) => {
  api.accessToken.setCustomClaim("'"$CLAIM_NS"'", event.user.email);
};'
  action_id=$(mgmt GET "/actions/actions?actionName=$(jq -rn --arg n "$ACTION_NAME" '$n|@uri')" \
    | jq -r --arg n "$ACTION_NAME" '.actions[]? | select(.name==$n) | .id' | head -1)
  if [ -z "$action_id" ]; then
    log "Creating post-login Action '${ACTION_NAME}'"
    action_id=$(mgmt POST "/actions/actions" "$(jq -n --arg n "$ACTION_NAME" --arg c "$action_code" \
      '{name:$n,code:$c,supported_triggers:[{id:"post-login",version:"v3"}]}')" | jq -r '.id')
    [ "$action_id" != "null" ] && [ -n "$action_id" ] || die "failed to create the Action"
  else
    log "Action already exists — updating its code"
    mgmt PATCH "/actions/actions/${action_id}" \
      "$(jq -n --arg c "$action_code" '{code:$c}')" >/dev/null
  fi
  log "Deploying the Action"
  mgmt POST "/actions/actions/${action_id}/deploy" >/dev/null

  # -- bind to the login flow, preserving existing bindings --
  local bindings
  bindings=$(mgmt GET "/actions/triggers/post-login/bindings" \
    | jq --arg id "$action_id" --arg n "$ACTION_NAME" '
        [.bindings[]? | {ref:{type:"action_id",value:.action.id},display_name:.display_name}]
        | if any(.ref.value == $id) then .
          else . + [{ref:{type:"action_id",value:$id},display_name:$n}] end
        | {bindings:.}')
  mgmt PATCH "/actions/triggers/post-login/bindings" "$bindings" >/dev/null
  log "Action bound to the post-login flow"

  # -- native app logout URLs --
  local urls_ios urls_android client
  urls_ios="potholecollect://${AUTH0_DOMAIN}/ios/${BUNDLE_ID}/callback"
  urls_android="potholecollect://${AUTH0_DOMAIN}/android/${BUNDLE_ID}/callback"
  client=$(mgmt GET "/clients/${NATIVE_CLIENT_ID}?fields=allowed_logout_urls,callbacks")
  echo "$client" | jq -e '.callbacks' >/dev/null || die "could not read native client ${NATIVE_CLIENT_ID}"
  mgmt PATCH "/clients/${NATIVE_CLIENT_ID}" "$(echo "$client" | jq \
    --arg a "$urls_ios" --arg b "$urls_android" '
      {allowed_logout_urls: ((.allowed_logout_urls // []) + [$a,$b] | unique),
       callbacks:          ((.callbacks // [])           + [$a,$b] | unique)}')" >/dev/null
  log "Native app callback + logout URLs ensured"
}

# ---------------------- part 2: server env + rebuild -----------------------
set_env_var() { # KEY VALUE FILE — replace-or-append, preserves everything else
  local key="$1" value="$2" file="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

deploy_server() {
  [ -f "$COMPOSE_FILE" ] || die "not in the repo? missing $COMPOSE_FILE"
  local dc
  if docker compose version >/dev/null 2>&1; then dc="docker compose";
  elif command -v docker-compose >/dev/null; then dc="docker-compose";
  else die "docker compose not found — run this part on the server host"; fi

  if [ ! -f "$ENV_FILE" ]; then
    warn "$ENV_FILE missing — creating from the example (fill POSTGRES_PASSWORD etc. before rerunning!)"
    cp "$REPO_DIR/.env.production.example" "$ENV_FILE"
  fi

  log "Updating $ENV_FILE (AUTH0_DOMAIN=${AUTH0_DOMAIN}, API_DOMAIN=${API_DOMAIN})"
  set_env_var AUTH0_DOMAIN "$AUTH0_DOMAIN" "$ENV_FILE"
  set_env_var API_DOMAIN "$API_DOMAIN" "$ENV_FILE"
  # Kill any stale explicit audience override — compose derives it from API_DOMAIN.
  if grep -qE '^AUTH0_AUDIENCE=' "$ENV_FILE"; then
    warn "removing stale AUTH0_AUDIENCE from $ENV_FILE (compose derives ${AUDIENCE})"
    sed -i.bak -E '/^AUTH0_AUDIENCE=/d' "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  fi
  grep -qE '^AUTH0_SPA_CLIENT_ID=.+' "$ENV_FILE" || warn "AUTH0_SPA_CLIENT_ID is empty — admin dashboard login will not work until set"

  log "Rebuilding + restarting api and admin containers"
  (cd "$REPO_DIR" && $dc -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build api admin)

  log "Waiting for the API to come up"
  local i ok=""
  for i in $(seq 1 30); do
    if curl -fsS "https://${API_DOMAIN}/api/v1/health" | grep -q '"ok":true'; then ok=1; break; fi
    sleep 2
  done
  [ -n "$ok" ] || die "health check failed: https://${API_DOMAIN}/api/v1/health"
  log "API healthy at https://${API_DOMAIN}/api/v1/health"

  # Sanity: an unauthenticated /me must now yield a 401 auth error (not a 404/500).
  local me
  me=$(curl -s "https://${API_DOMAIN}/api/v1/me")
  echo "$me" | grep -q 'UNAUTHORIZED\|invalid_token\|Unauthorized' \
    && log "Auth middleware is active (unauthenticated /me correctly rejected)" \
    || warn "unexpected /me response: $me"
}

# --------------------------------- main ------------------------------------
[ "$DO_AUTH0" = 1 ] && provision_auth0
[ "$DO_DEPLOY" = 1 ] && deploy_server

log "Done."
if [ "$DO_AUTH0" = 1 ]; then
  cat <<EOF

Remaining manual bits (cannot be automated):
  - Mobile app: restart Metro, then LOG OUT and log back in (the stored token
    still carries the old audience).
  - If you did NOT run the server part on the host yet, do:
      git pull && AUTH0_MGMT_TOKEN= ./tools/fix-auth-deploy.sh --deploy-only
EOF
fi
