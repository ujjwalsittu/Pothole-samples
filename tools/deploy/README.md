# @pothole/deploy — one-command deployer

Interactive CLI that automates `docs/DEPLOYMENT.md` end to end. macOS-first
(hints use Homebrew) but works on any Linux with the same binaries.

```bash
# from the repo root
npm install          # once (workspace)
npm run deploy       # interactive
npm run deploy -- --dry-run   # rehearse: prints every command, executes nothing
```

## What it does

1. **Preflight** — checks `git`/`ssh`/`aws`/`railway`, printing
   `brew install …` hints for anything missing.
2. **Questionnaire** — domains (api./admin. derived from your base domain),
   Auth0 (domain, audience, SPA client id), Resend, Let's Encrypt email,
   repo URL. Secrets are masked.
3. **Railway path** (`docs/DEPLOYMENT.md` §1–2)
   - forces a fresh login (`railway logout` → `railway login`)
   - `railway init`/`link`, Postgres via `railway add --database postgres`
   - sets every API env var (`DATABASE_URL` as the `${{Postgres.DATABASE_URL}}`
     reference; `STORAGE_DRIVER=s3` — you supply an existing S3/R2 bucket,
     Railway disk is ephemeral)
   - `railway up`, `railway domain`, then prints the custom-domain CNAME
     instructions and the admin-service (second service) recipe.
   - Railway CLI syntax varies by version — every invocation runs through the
     step runner: on failure you get the exact manual command + doc pointer
     and a continue/abort choice.
4. **AWS Lightsail path** (`docs/DEPLOYMENT.md` §2b)
   - three authentication methods, all validated with `sts get-caller-identity`:
     1. **Access keys** → written to a dedicated aws-cli profile
        `pothole-deploy` (your default profile/session is never touched —
        that's the isolation). Works on any AWS account.
     2. **Browser login (SSO)** → `aws configure sso --profile pothole-deploy`
        opens the browser; requires IAM Identity Center enabled on the
        account. No long-lived keys pasted.
     3. **Existing profile** → reuse a profile you already trust, as-is.
   - region + AZ pickers (Mumbai first), live plan picker from
     `get-bundles` (falls back to known bundle ids)
   - optional S3: bucket `pothole-media-<hex>` (+ public-access-block), IAM
     user `pothole-app` with the minimal media policy, access key for the
     server — or plain local disk
   - Ubuntu 24.04 instance `pothole-server`, waits until running, opens
     80/443, allocates + attaches static IP `pothole-ip`
   - prompts you to create the two **A records**, then verifies propagation
     (12×10 s, skippable)
   - SSH key `pothole-deploy-key` → `~/.ssh/pothole-deploy-key.pem`
   - uploads and runs ONE provisioning script over SSH: apt, Node 20, nginx,
     certbot, optional Docker (OSRM), Postgres 16 with a generated password,
     clone, `npm install`, writes `apps/api/.env`, migrations, systemd unit,
     health check, admin build (`.env.production`), nginx site
     (1100m uploads, SPA fallback), `certbot --nginx` for both domains,
     renewal dry-run
   - final health check of `https://api.<domain>` from your machine.
5. **Summary** — URLs, where credentials live, and a checklist: exact Auth0
   callback URLs (SPA + native), primary-admin first login, a ready-to-paste
   mobile `app.json` extra block, Resend domain verification.

## Costs

The Lightsail path **starts billing immediately**: instance ($7–44/mo per
the plan you pick), static IP (free while attached), S3 storage/egress if
chosen. Railway bills usage after the trial. Nothing is created without an
explicit confirmation.

## Teardown (Lightsail)

```bash
P="--profile pothole-deploy --region <your-region>"
aws lightsail delete-instance    --instance-name pothole-server $P
aws lightsail release-static-ip  --static-ip-name pothole-ip $P
aws lightsail delete-key-pair    --key-pair-name pothole-deploy-key $P
aws iam delete-user-policy --user-name pothole-app --policy-name pothole-media $P
aws iam list-access-keys --user-name pothole-app $P   # then delete-access-key each
aws iam delete-user --user-name pothole-app $P
aws s3 rb s3://pothole-media-<hex> --force $P         # deletes ALL media!
rm ~/.ssh/pothole-deploy-key.pem
```

Railway: delete the project from the dashboard.

## Testing / scripting

`--dry-run` walks every prompt but prints commands instead of executing
(including the full generated provisioning bash script for review). Answers
can be injected for CI-style testing:

```bash
DEPLOY_ANSWERS='["lightsail","potholes.example.com",…]' npm run deploy -- --dry-run
```
