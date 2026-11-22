# Infrastructure: Cloud Run functions

CyberChefCloud runs in the browser. A Cloud Run function is used only when an operation needs something the browser can't do safely or at all:

- hold a third-party secret, such as an API key;
- call an API that doesn't allow browser (CORS) requests;
- run a server-side library.

The rule is **one ingredient calls one function, and that function does one job.**

To add a new function, use the `add-cloud-run-function` skill in `.claude/skills/`.

## Services

All services are in GCP project `cyberchefcloud` (number `593556123914`), region `europe-west2`.

| Folder | Cloud Run service | Called by op | Secrets (Secret Manager) |
| :--- | :--- | :--- | :--- |
| `google-http-proxy/` | `google-http-proxy` | `Google HTTP Request` | none |
| `cloud-convert-proxy/` | `cyber-chef-cloud-convert` | `Cloud Convert` | `CLOUDCONVERT_API_KEY` |

Deploy one with its own script, for example `infrastructure/cloud-convert-proxy/deploy.sh`.

## Secrets: what may be committed

This repository is public. Each folder holds only code and configuration that is safe to publish.

- **Never committed:** API keys, tokens, service account key files, and `.env` files. Secrets are stored in **Secret Manager** and passed to the service by `deploy.sh` with `--set-secrets NAME=NAME:latest`. Cloud Run exposes them to the code as environment variables at runtime.
- **Safe to commit:** project ID and number, region, service names, service URLs, secret *names*, and allowed CORS origins. These are already visible in the public frontend.
- Code must never log or return a secret value, including inside error messages.

Rotate a secret without redeploying by adding a new version (`gcloud secrets versions add NAME --data-file=-`). New instances pick up `latest`.

## Access control

The browser calls these services directly, so Cloud Run's IAM check is switched off (`--no-invoker-iam-check`). Two other controls replace it:

1. **CORS:** only `https://andy7475.github.io` and `http://localhost:*` may call a service from a browser. CORS does not stop `curl` or scripts.
2. **Caller check:** the function sends the caller's Google token to `projects.testIamPermissions` on `cyberchefcloud` and rejects callers who lack `run.routes.invoke`. That limits use to people with access to the project. Every function must do this. The op must therefore refuse API-key auth, because a function can't tell whose key it is.
