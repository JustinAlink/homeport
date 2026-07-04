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

Reports that are especially valuable: auth bypasses, capability-gate bypasses,
secret leakage (tokens are stored 0600 server-side and scrubbed from streamed
output), and anything that lets a non-admin reach the Docker API.

## Supported versions

The latest release (`latest` image tag) is supported. Older tags don't get
backported fixes — self-update exists precisely to make staying current easy.
