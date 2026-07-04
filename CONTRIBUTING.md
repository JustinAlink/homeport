# Contributing to homeport

Thanks for wanting to help! homeport is a small, focused project — these notes
keep contributions smooth for everyone.

## Ground rules

- **Open an issue first** for anything bigger than a small fix, so we can agree
  on the direction before you invest time.
- Keep PRs focused: one feature or fix per PR.
- homeport is **read-only by default, opt-in for everything mutating** — new
  capabilities must follow the same tiered model (see the Security section of
  the README) and document the socket-proxy permissions they need.

## Development setup

```bash
npm install
cp .env.example .env        # HOMEPORT_DEMO=true gives you a synthetic fleet, no Docker needed
npm run dev                 # http://localhost:3000
```

Demo mode (`HOMEPORT_DEMO=true`) is the fastest way to hack on UI: every
feature has a demo path, and PRs for new features should include one.

## Tests & checks

```bash
npm test                    # node --test over test/*.test.ts
npm run build               # production build must stay clean
```

- There is **no CI** — GitHub Actions is deliberately disabled on this repo.
  Run the suite locally before pushing; PRs are verified by the maintainer.
- Pure logic lives in `*-core.ts` modules with **no runtime relative imports**
  (node's test runner can't resolve extensionless paths) and gets unit tests.
  Anything touching fs/network/Docker wraps a core module.

## Code style

- Match what's around you: Vue 3 `<script setup>`, Tailwind, small components.
- Comments explain *constraints and gotchas*, not what the next line does.
- New config follows the six-place wiring: `HomeportConfig`, `getConfig()`,
  `getEnvLocks()`, `getSettingsView()`, `PersistedSettings`, and
  `settings.post.ts` validation — plus `.env.example` and the README table.

## Reporting security issues

Please **don't** open public issues for vulnerabilities — see
[SECURITY.md](SECURITY.md).
