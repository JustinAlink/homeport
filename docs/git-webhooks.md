# Deploy on push: git webhooks and auto-sync

A stack deployed from a git repository (Stacks, **From git**) can keep itself in step with that
repository in two ways:

- **Webhook**: your git host (GitHub, Gitea, Forgejo, GitLab, Bitbucket, or a script) calls homeport
  when you push, and the stack updates within seconds.
- **Auto-sync**: homeport asks the repository for new commits on its own, every few minutes, and
  updates the stack when there are some. Use it when your git host cannot reach homeport.

Both run exactly what the **Update from git** button runs: `git fetch` of the branch or tag the
stack follows, a hard reset to it, then `docker compose up -d --build --remove-orphans`. Local edits
to files the repository tracks are overwritten, as with the button.

Both are set up on the stack's own page, in the **Deploy on push** card. Tested end to end with real
GitHub, GitLab 19.6 and Gitea 28.4 deliveries: each signed push updated the stack to the new
commit (a private GitHub repository cloned with a token; GitLab with both its secret token and its
signing token), GitHub's ping got a 200, and a wrong secret or signing token was refused with 401.
Bitbucket's signature check follows its documentation but has not been tried against Bitbucket
itself.

## Turning webhooks on

Webhooks are **off by default**, because they open a public endpoint. Turn them on in
**Settings, Capabilities, Deploy git stacks on push (webhooks)**, or with the environment variable:

```yaml
environment:
  HOMEPORT_ALLOW_STACKS: "true"        # required: webhooks only work on top of stack management
  HOMEPORT_ALLOW_GIT_WEBHOOKS: "true"  # locks the switch in Settings
```

Auto-sync opens nothing to the outside, so it only needs stack management; it is off for every stack
until you switch it on for that stack.

## Setting up a webhook

1. Open the stack (`/stacks/<name>`) and click **Create webhook** in the **Deploy on push** card.
2. Copy the **Payload URL** and the **Secret**. The secret is shown once; homeport keeps it to check
   signatures, but never shows it again. Lost it? **Regenerate secret** and paste the new one.
3. Paste both into your git host (the card has the steps for each one, and a link to the right
   settings page of the repository):

| Git host | Where | Fields |
| --- | --- | --- |
| GitHub | Settings, Webhooks, Add webhook | Payload URL, Content type `application/json`, Secret, *Just the push event* |
| Gitea / Forgejo | Settings, Webhooks, Add webhook, Gitea (or Forgejo) | Target URL, POST content type `application/json`, Secret, Trigger on *Push events* |
| GitLab | Settings, Webhooks, Add new webhook | URL, Secret token, Trigger *Push events* (and *Tag push events* for a stack that follows a tag) |
| Bitbucket | Repository settings, Webhooks, Add webhook | URL, Secret, trigger *Repository push* |
| Anything else | | POST with `X-Homeport-Secret: <secret>` or `Authorization: Bearer <secret>` |

GitHub sends a *ping* as soon as the webhook is added, and Gitea, Forgejo and GitLab have a test
button. The card's **Last delivery** line shows what homeport made of it (verified, ignored and why,
or rejected and why), so a mistyped secret is visible without digging through logs.

### Reaching homeport from the internet

The URL is built from the address you opened homeport with. If that is a LAN address, a `.local`
name or `localhost`, the card says so: github.com and gitlab.com cannot reach it (a Gitea or Forgejo
on the same network can). For a hosted forge, homeport has to be reachable through your reverse
proxy, at least the path `/api/hooks/git/`. Open homeport through that public domain and copy the
URL from there. If your proxy puts a login (forward auth, basic auth) in front of homeport, exempt
`/api/hooks/git/` from it: the forge cannot log in, and the secret already protects the path.

If you cannot expose homeport at all, use auto-sync instead.

### Signatures

Every delivery must prove it knows the stack's secret. homeport checks, in this order, the first of
these that is present, and only that one:

| Header | Sent by | Check |
| --- | --- | --- |
| `X-Hub-Signature-256: sha256=<hex>` | GitHub, also Gitea and Forgejo | HMAC-SHA256 of the raw body |
| `X-Gitea-Signature` / `X-Forgejo-Signature: <hex>` | Gitea, Forgejo | HMAC-SHA256 of the raw body |
| `X-Hub-Signature: sha256=<hex>` | Bitbucket | HMAC-SHA256 of the raw body (SHA-1 is refused) |
| `webhook-signature: v1,<base64>` | GitLab 19+ with a signing token | Standard Webhooks: HMAC-SHA256 of `id.timestamp.body`, at most 5 minutes old |
| `X-Gitlab-Token: <secret>` | GitLab | the secret itself |
| `X-Homeport-Secret: <secret>` or `Authorization: Bearer <secret>` | scripts, CI | the secret itself |

All comparisons are constant-time. GitLab 19 and later can sign deliveries with a **signing token**
that GitLab generates; paste it into the GitLab tab of the card to have those signatures checked too.
The secret token keeps working alongside it.

### Which pushes deploy

Only a push to the branch or tag the stack follows (the one it was cloned from). Everything else is
answered `202` with the reason, and nothing runs:

- a push to another branch or tag,
- a push that deletes the followed branch,
- other events (issues, pull requests, and so on). A ping is answered `200`.

A delivery without any ref (a bare `curl -X POST` with the secret header) always deploys: it is a
deploy button for scripts. With a JSON body like `{"ref": "refs/heads/main"}` it deploys only for
that ref.

```sh
curl -X POST -H "X-Homeport-Secret: $SECRET" https://homeport.example.com/api/hooks/git/<stack>/<id>
```

### Bursts and overlaps

A push answers at once (forges give up after about 10 seconds) and the update starts 5 seconds
later. Every push in that window joins the same update, so pushing three branches, or a tag and its
branch, runs one update. A push that arrives while an update is running queues exactly one more run
after it, because the running one may have fetched before that push landed.

Only one update of a stack runs at a time, whatever started it: a click on **Update from git** while
a push deploy is running gets a "busy" message, and a push that arrives during a click waits for it.

## Auto-sync

Tick **Update when the repository moves** and pick an interval (2 minutes to 24 hours, 5 minutes by
default). On each check homeport runs `git ls-remote` for the followed ref and updates the stack only
when the remote commit differs from the deployed one.

A commit whose update failed is **held**: auto-sync does not retry it every interval, which would
rebuild a broken build (and notify you) every few minutes. The card says so. Push a fix, or click
**Update from git** to try again; either clears the hold.

## Responses

| Status | Meaning |
| --- | --- |
| `200` | verified: an update is queued (`scheduled`, `merged` into one about to start, or `queued` after the running one), or a ping |
| `202` | verified, but nothing to do (another ref, a deleted branch, another event); `reason` says why |
| `400` | the body is not JSON |
| `401` | no signature, or a wrong one (the reason is on the stack's page, not in the response) |
| `403` | stacks or webhooks are turned off |
| `404` | no such webhook; an unknown stack and an unknown id get the same answer |
| `413` | body over 2 MB |
| `429` | more than 30 deliveries a minute to one webhook |

## Where it shows up

- **Deploy on push** card: the last delivery and the last auto-sync check, with **Show output** while
  the update's log is still kept (10 minutes).
- **Activity**: every push or auto-sync update, as "stack X updated from git (on push)" or
  "(auto-sync)", or the failure with its last line. These events also go to your alert channels,
  like auto-update results.
- The container log: a line per update (`[git-webhooks]`) and per rejected delivery.

## Security notes

- The endpoint is `POST /api/hooks/git/<stack>/<id>` and is the only part of homeport reachable
  without a login. It refuses everything while the capability is off (`403`), answers an unknown
  stack or id with `404`, and checks the secret before reading the payload's meaning.
- The secret is 256 random bits, stored in `<data>/git-webhooks.json` (mode 0600) and sent to the
  browser only in the answer to **Create webhook** or **Regenerate secret**. It is stored as is,
  because an HMAC can only be checked with the key itself.
- The webhook settings (including the URL) are admin only: viewer accounts and read-only API tokens
  get `403`.
- homeport's own stack never updates itself from git: a webhook for it cannot be created, and a
  delivery or a sync that reaches it anyway is refused. Use **Update homeport**.
- Deleting a stack deletes its webhook. A new stack with the same name starts without one.
- **Settings, Backup** includes each stack's webhook (its URL and secret) and auto-sync setting, so
  after a restore on a new machine your git host keeps delivering without being reconfigured, as
  long as the machine is reached at the same address. The delivery and sync history is not included.

## Demo mode

With `HOMEPORT_DEMO=true` the `media` stack has a webhook and a past delivery. Deliveries to it are
verified for real (regenerate the secret to get one you can sign with) and then deploy nothing.
