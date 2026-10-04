# GeoLibre Admin

A reference admin UI for self-hosted [GeoLibre](https://github.com/opengeos/GeoLibre)
deployments. Like GeoLibre's reference projects server, it is a correctness
baseline built against GeoLibre's published contracts, not a hardened product.
Background: [opengeos/GeoLibre#2775](https://github.com/opengeos/GeoLibre/discussions/2775), whose `deployment.json` schema is now merged (#2785).

It has two parts:

- **Deployment policy.** An offline editor for what a deployment offers:
  capabilities, the interface profile (experience level, lock, hidden menus,
  data sources and plugins), the plugin registry and allow/block lists, the
  organization service library, sharing and embedding, GeoLens, the AI
  assistant, branding, and the container's server settings. It
  validates with the same rules GeoLibre's container applies at startup and
  exports for one of two targets: *Legacy GeoLibre (<= v3.2.0)* gives the files
  released versions read (`admin-profile.json`, a services file, a `.env`
  file, `docker run` commands, `compose.yaml`) and lists the settings it
  can't express; *GeoLibre with runtime deployment.json* gives one
  `deployment.json` (GeoLibre's schema, below), an operator-only `.env`, and
  commands that mount the file.
- **Organizations and groups.** A console for any server implementing the
  [GeoLibre projects API](https://github.com/opengeos/GeoLibre/blob/main/docs/server-api.md),
  such as the reference server in `backend/geolibre_server_api`: create and
  configure organizations and groups, manage members and roles, issue and
  revoke invitations, approve join requests, accept invitations, transfer group
  ownership, and remove projects from a group.

## Use it

The latest build is published at <https://opengeos.org/geolibre-admin>.
The policy editor never sends anything anywhere: drafts stay in the browser's
localStorage and exports are downloads.

Or run it yourself:

```bash
docker run --rm -p 8080:80 ghcr.io/opengeos/geolibre-admin
```

Or run it with a local GeoLibre reference projects server:

```bash
docker compose up -d            # pull the admin image, build the server
docker compose up -d --build    # build the admin image from this checkout
```

Open <http://localhost:8080/#/server> and connect to `http://localhost:8000`.
The console has no sign-up, so create the first account on the server:

```bash
curl -X POST http://localhost:8000/api/accounts -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"correct horse battery staple"}'
```

The server port is bound to `127.0.0.1` and has no rate limiting, so this is a
local stack, not a production deployment. Override ports with
`GEOLIBRE_ADMIN_PORT` and `GEOLIBRE_SERVER_PORT`.

The image serves the static build from nginx with a strict
Content-Security-Policy. Its `connect-src` allows any HTTPS origin plus
loopback; narrow it to your projects server in `docker/nginx.conf` for
production.

### Connecting to a projects server

- The server must allow this app's origin in `GEOLIBRE_CORS_ORIGINS` (the
  reference server allows `*` by default for API routes).
- Signing in with a username and password exchanges them for a personal token
  with only `read:projects` and `write:projects`, expiring after one day. The
  token is kept in `sessionStorage` for the tab and revoked on sign-out. A
  pasted token is used as is and never revoked here.
- The projects API has no server-wide administrator, so the console shows the
  organizations and groups your account belongs to, and what you can do follows
  your role in each.
- Put the server behind a rate-limiting proxy before signing in over the
  internet, as `docs/server-api.md` describes.

## What deploys how

| Setting | GeoLibre reads it from | When |
| --- | --- | --- |
| Interface profile | `admin-profile.json` at the app root | Page load |
| Service library | `GEOLIBRE_SERVICES_FILE`, `GEOLIBRE_BUILTIN_SERVICES` | Container start |
| Share, collaboration, embed origins, GeoLens, app name | `GEOLIBRE_*` env | Container start |
| Sidecar, conversion roots, PostGIS hosts | `GEOLIBRE_*` env | Container start |
| Capabilities, welcome wizard | `VITE_GEOLIBRE_CAPABILITIES`, `VITE_WELCOME_DISABLED` | **Build time** |

In releases up to v3.2.0, capabilities are build-time only
([GeoLibre#1673](https://github.com/opengeos/GeoLibre/issues/1673)); the legacy
export says so and includes the `docker build` command when the policy needs
its features. The runtime deployment target requires a GeoLibre build with merged
policy delivery and enforcement. That runtime validates its input during startup,
fails boot on invalid or unreadable policy, and enforces capabilities on protected
sidecar routes. Client-side interface and plugin visibility alone are not a
security boundary.

## `deployment.json`

[`schema/deployment.schema.json`](schema/deployment.schema.json) is a synced
copy of GeoLibre's canonical schema for a single, versioned policy document.
`schema/SOURCE.json` records the upstream commit the schema came from.

The published v3.2.0 release still reads the served app-root policy and does not
include merged runtime delivery or enforcement. GeoLibre's current main reads
the public input through `GEOLIBRE_DEPLOYMENT_FILE` and atomically writes the
separately served `/deployment.json` at startup. The deployment export mounts
the input read-only at `/etc/geolibre/deployment.json` and sets that variable;
do not mount over the served app-root file.

The policy JSON is public and never contains secrets. When `ai.enabled` is true,
GeoLibre also requires operator-only `GEOLIBRE_AI_URL=/ai`,
`GEOLIBRE_AI_PROXY_URL`, and `GEOLIBRE_AI_PROXY_TOKEN` settings. Fill those
values in the runtime environment, never in `deployment.json`.

## Development

Node 22+.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests
npm run typecheck
npm run build        # dist/
```

Contract tests run the API client against a live, disposable projects server.
With Docker, use the compose server:

```bash
docker compose -p geolibre-admin-test up -d --wait geolibre-server
GEOLIBRE_TEST_SERVER_URL=http://127.0.0.1:8000 npx vitest run tests/server.integration.test.ts
docker compose -p geolibre-admin-test down -v
```

The separate project name keeps the tests' accounts out of your regular stack's
volume. Stop the regular stack first, since both use port 8000.

Or install it with pip:

```bash
pip install "geolibre-server-api @ git+https://github.com/opengeos/GeoLibre.git#subdirectory=backend/geolibre_server_api"
GEOLIBRE_PUBLIC_URL=http://127.0.0.1:8000 geolibre-server-api &
GEOLIBRE_TEST_SERVER_URL=http://127.0.0.1:8000 npx vitest run tests/server.integration.test.ts
```

Generated files:

- `src/catalog/geolibre-catalog.json` lists the ids GeoLibre lets a profile
  hide and their complexity tiers. They live in GeoLibre's source, so regenerate
  from a checkout with `npm run sync:catalog -- ../GeoLibre`. A weekly workflow
  fails when it falls behind GeoLibre `main`.
- `schema/deployment.schema.json` is GeoLibre's own schema, copied (never edited
  by hand) with `npm run sync:schema -- ../GeoLibre`, which also records the
  GeoLibre commit in `schema/SOURCE.json` and regenerates
  `src/policy/schema-validator.generated.js`. Run `npm run sync:schema` with no
  argument to regenerate only the validator. The validator is precompiled so the
  app needs no `eval` under a strict CSP; CI fails when it is stale, and the
  weekly "GeoLibre contract drift" workflow fails when the schema or catalog
  falls behind GeoLibre `main`.

## License

MIT
