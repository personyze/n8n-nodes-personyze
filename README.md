# n8n-nodes-personyze

An [n8n](https://n8n.io) community node for [Personyze](https://personyze.com).
Create and update visitors, manage audiences, read tracked events, and start a
workflow when a profile changes.

Two nodes and one credential, over the existing REST API — no backend work.

- **Personyze** — declarative node. Resources: Visitor, Audience, Product, Interaction, Event.
- **Personyze Trigger** — polling trigger on profile changes.
- **Personyze API** — HTTP Basic, user name `api`, password an API key.

## Operations

| Resource | Operation | Endpoint |
| --- | --- | --- |
| Visitor | Create or Update | `POST /users` |
| Visitor | Get Many | `GET /users/where/…` |
| Visitor | Update | `PUT /users/where/…` |
| Visitor | Delete | `DELETE /users/where/…` |
| Audience | Get Many | `GET /user_lists` |
| Audience | Create | `POST /user_lists` |
| Audience | Add Visitor | `POST /user_list_users` |
| Product | Create or Update | `POST /products` |
| Product | Delete | `DELETE /products/where/…` |
| Interaction | Record | `POST /do` |
| Event | Get Many | `GET /events/where/…` |

## Credentials

Generate a key in Personyze under **Account settings → Integrations**, and paste
it into the node's credential. The node sends it as HTTP Basic with the user
name `api` — you never type a user name yourself. Keys are shared with the
Full-featured API, Zapier and Make cards, so a key from any of them works.

The credential test calls `GET /rest/account`, which reads nothing and changes
nothing, and answers `401` for a key that is wrong, revoked, or sent over plain
HTTP.

## Development

```bash
npm install
npm run build     # tsc + copy icons into dist
npm run lint      # eslint-plugin-n8n-nodes-base, the rules verification runs
```

To try it in a local n8n:

```bash
npm run build && npm link
cd ~/.n8n/custom && npm link n8n-nodes-personyze
n8n start
```

**If `npx n8n-node new` produces different toolchain files, keep theirs.** n8n
strongly suggests scaffolding with their CLI so the package matches whatever
conventions they currently check, and their scaffolding moves faster than this
README does. The parts that are actually Personyze-specific — `nodes/`,
`credentials/`, and the `n8n` block in `package.json` — drop straight into a
fresh scaffold.

## Publishing

Two separate things, in this order.

**1. Publish, unverified.** No approval needed. Anyone self-hosting n8n can
install it the day it lands on npm. This is the cheap way to get real users
before submitting anything.

**2. Get it verified.** Verification is what makes the node discoverable in the
nodes panel and installable on n8n Cloud. Submit through the
[Creator Portal](https://internal.users.n8n.cloud/webhook/creator-portal) once
the package is live.

Publishing happens through `.github/workflows/publish.yml`, on a GitHub release.
That is not a preference — **since 1 May 2026 n8n only accepts verified nodes
published from a GitHub action with an npm provenance statement**, so a package
pushed from a laptop is rejected. The workflow needs `NPM_TOKEN` in the repo
secrets and keeps `id-token: write`, which is what mints the provenance.

`npx @n8n/scan-community-package n8n-nodes-personyze` is part of the checklist,
but it resolves the package from the npm registry — it cannot run before the
first publish. Expect a `404` until then.

## Verification checklist

Against n8n's
[verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines):

- [x] TypeScript, builds clean
- [x] **Zero runtime dependencies** — `dependencies` is empty and stays empty
- [x] No filesystem or environment-variable access
- [x] One service per package; a trigger node beside the main node is allowed
- [x] Not a duplicate — there is no existing Personyze node
- [x] Not a logic or flow-control node
- [x] MIT licence
- [x] English only, throughout
- [x] `n8n-community-node-package` keyword
- [x] Lint passes
- [ ] **Public GitHub repo** at the URL in `package.json`, with the npm author
      matching the repo owner
- [ ] **Published from the GitHub action**, with provenance
- [ ] `@n8n/scan-community-package` run against the published package

## Decisions worth knowing about

**Which lookup keys work depends on the endpoint, and the difference is not
obvious.** On the visitor object, only Email and Visitor ID resolve: Internal ID
is stored and returned, but a search on it matches nothing and a second write
carrying the same one duplicates rather than merges. So it is a field to write,
never a key to sync on.

But `Add Visitor to Audience` is a different endpoint with a different
resolver, and there CRM ID does work. This was previously assumed broken here
and left out. Re-tested against a live account: two profiles were written, one
carrying `internal_text_id` and one carrying `internal_id`, and both were found
and added by CRM ID — confirmed by reading the membership rows back, because
that endpoint answers every call with a meaningless `lastInsertId` and cannot be
trusted to report its own success.

**Audience names are not unique.** Posting the same name twice returns two
different ids. `Audience → Create` therefore duplicates if a workflow runs it
every time; look the audience up with `Get Many` first, and create only on a
miss.

**Product IDs, by contrast, are unique** — `internal_id` carries a UNIQUE index
and the endpoint inserts in patch mode. So `Create or Update` genuinely updates
in place, and fields left empty keep their stored values rather than blanking
them. That is what makes a partial sync safe: a workflow that only knows price
and stock can run against products described elsewhere.

**There is no "Return All".** The API refuses any read whose `offset + limit`
passes 1000 rows. A `returnAll` toggle would be a promise the API cannot keep,
so `Get Many` takes a `limit` instead — and the trigger, not a paged read, is
the right way to keep up with a large account.

**The trigger polls, and advances its watermark from the data.** An instant
trigger would need Personyze to POST to a URL n8n generates, which means a
subscription registry the backend does not have. The poll watches
`data_last_modified`, which a database trigger maintains on every write and
which is indexed, so the query is served from an index. The watermark moves to
the newest row actually seen rather than to the wall clock — a profile written
while the request was in flight would otherwise fall into the gap between the
two and never be emitted.

## Not covered

Anonymous visitors. Every operation here is keyed on an identified profile; a
visitor Personyze knows only by cookie has no stable handle to give a workflow.
