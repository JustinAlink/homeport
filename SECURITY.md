# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately** via
[GitHub's private vulnerability reporting](https://github.com/JustinAlink/homeport/security/advisories/new)
on this repository. You should get a response within a week.

Please do not open public issues for security problems.

## Scope & model

homeport's security model, in one paragraph: the app is **read-only by
default** and talks to Docker through a permission-scoped socket proxy, never
the raw socket. Every mutating capability (start/stop, updates, stacks,
terminal, proxy admin) is an explicit opt-in, and the README documents the
extra socket-proxy permissions each one needs. The whole UI/API sits behind a
single admin login (scrypt-hashed, HMAC-signed session cookie) and is expected
to be deployed behind HTTPS.

Optional forward-auth (`HOMEPORT_TRUSTED_HEADER`) trusts an upstream proxy to
authenticate the user. It is off unless set, and — by design — assumes homeport
is reachable only through that proxy; a directly-reachable instance with it
enabled is a forgeable-header bypass, which is operator misconfiguration rather
than a homeport vulnerability (the README and env docs call this out).

Scoped API tokens (`Authorization: Bearer …`) are an alternative credential for
automation: stored hashed (sha256, shown once), either read-only (GET only, and
never `/api/backup`) or full. No token can mint or revoke tokens — that requires
an interactive login — so a leaked token can't escalate to more tokens.

Reports that are especially valuable: auth bypasses, capability-gate bypasses,
secret leakage (tokens are stored 0600 server-side and scrubbed from streamed
output), and anything that lets a non-admin reach the Docker API.

Note: the admin-only `/api/backup` export bundles secrets — the password hash,
session secret, proxy credentials and stack git tokens — into one JSON file. It
inherits the login's exposure (in open mode it's reachable without a password),
so treat the endpoint and its output like a password.

## Supported versions

The latest release (`latest` image tag) is supported. Older tags don't get
backported fixes — self-update exists precisely to make staying current easy.
