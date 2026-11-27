# Single sign-on (OpenID Connect)

homeport can let people sign in through your identity provider: Authentik, Authelia, Keycloak,
Pocket ID, Zitadel, or any other OpenID Connect provider. It is off by default. The admin
password keeps working alongside it, so a broken provider never locks you out.

## How access is decided

Signing in at the provider is not enough. homeport reads the person's groups and gives them one
of two roles:

| In a group listed under | Gets |
| --- | --- |
| Admin groups | Full control, the same as the admin password, as an account of their own |
| Viewer groups (and no admin group) | A read-only account |
| Neither | Turned away, with "not in a group allowed into homeport" |

With no groups configured, nobody gets in through SSO. Everyone who signs in gets an account,
created on their first sign-in and listed under Settings > Security & users > User accounts with
an SSO badge and their role. The role follows their groups at every sign-in, so someone moved
from an admin group to a viewer group comes back read-only. Accounts have no password and are
matched by the provider's issuer and account id (`sub`), never by email or username, so renaming
someone at the provider does not create a second account and a reused email cannot take over an
existing one.

**Sign out** on an account ends its sessions on every device at once (it can sign in again);
**Delete** removes it (it comes back on the next sign-in if its groups still allow it). Logging
out ends that person's own sessions everywhere, nobody else's. Turning single sign-on off ends
every SSO account's sessions.

Group names are compared without case, and a leading `/` (Keycloak's full group paths) is ignored.

## Setting it up

1. At the provider, create an OpenID Connect client (confidential, authorization code flow) with
   the redirect URI `https://<homeport's address>/api/auth/oidc/callback`. The settings page
   shows the exact value with a copy button once the public URL is filled in.
2. In homeport, open Settings > Security & users > Single sign-on and fill in homeport's public URL, the
   issuer URL, client ID and client secret. Press **Test the provider** to check discovery.
3. Set the admin and viewer groups, tick **Offer single sign-on on the login page**, and save.

Optional:

- **Button label**, for example "Sign in with Authentik".
- **Go straight to the provider** skips the login page on a plain visit. It never redirects after
  a logout or a failed attempt, so a broken provider cannot trap the browser in a loop.
- **Hide the password form** shows only the SSO button. `/login?local=1` always brings the
  password form back.

The same settings can come from the environment, which locks them on the page:

```env
HOMEPORT_PUBLIC_URL=https://hub.example.com
HOMEPORT_OIDC=true
HOMEPORT_OIDC_ISSUER=https://auth.example.com/application/o/homeport/
HOMEPORT_OIDC_CLIENT_ID=homeport
HOMEPORT_OIDC_CLIENT_SECRET=...
```

### Provider notes

- **Authentik:** the issuer is `https://<authentik>/application/o/<slug>/` (keep the trailing
  slash). Groups come in the `groups` claim with the `profile` scope (Authentik has no `groups`
  scope; homeport leaves it out by itself). Pick a signing key on the provider: without one
  Authentik signs ID tokens with the client secret (HS256), which homeport refuses, and make sure
  "authorization code" is among the provider's grant types. Tested with Authentik 2026.8.
- **Authelia:** add the `groups` scope to the client. Authelia puts groups in userinfo rather than
  the ID token; homeport reads both. The client's default `token_endpoint_auth_method`
  (`client_secret_basic`) is what homeport uses. Authelia insists on HTTPS for its own address;
  with a private CA, give homeport's container `NODE_EXTRA_CA_CERTS`. Tested with Authelia 4.39.
- **Keycloak:** the issuer is `https://<keycloak>/realms/<realm>`. Add a "Group Membership" mapper
  with claim name `groups`, added to the ID token or userinfo (homeport reads both, never the
  access token). Keycloak has no `groups` scope and refuses a sign-in that asks for one; homeport
  only asks for scopes the provider lists, so the default works, and **Test the provider** names
  any scope it leaves out. For client roles instead, set the groups claim to
  `resource_access.<client>.roles` and switch on "Add to ID token" (or "Add to userinfo") on
  Keycloak's client roles mapper: by default those roles are only in the access token.
  Tested with Keycloak 26.8.
- **Pocket ID:** request the `groups` scope.
- **Zitadel:** set the groups claim to `urn:zitadel:iam:org:project:roles` and turn on "Assert
  Roles on Authentication" for the project.

## Security

- The protocol is handled by [openid-client](https://github.com/panva/openid-client): discovery,
  the authorization code flow with PKCE (S256), and ID token validation (issuer, audience, expiry,
  nonce, and the signature against the provider's published keys, so an ID token signed with the
  client secret is refused). homeport adds no JWT handling of its own.
- The client secret goes to the token endpoint with HTTP Basic (`client_secret_basic`), the
  standard's default, unless the provider lists only `client_secret_post`.
- A refused sign-in is logged with the provider's own error code and description.
- PKCE verifier, state and nonce are fresh for every attempt and travel in a signed, ten-minute,
  httpOnly cookie scoped to `/api/auth/oidc`. A callback without that cookie, with a changed state,
  or from another browser is refused.
- The redirect URI is built from the configured public URL, never from the request's Host header.
- After sign-in homeport only returns to a path on its own site (no open redirect).
- The client secret is never sent to the browser; leaving the field blank on save keeps it.
- An `http://` issuer works (for a provider on a private network), with a warning on the page:
  tokens then cross the network unencrypted.
- The provider's own MFA covers SSO sign-ins, so homeport's TOTP step is not asked again.
  API tokens and forward-auth are unaffected by SSO.

## Limits

- Sessions last 30 days like password sessions. Removing someone from a group at the provider
  stops their next sign-in, not a session they already have: press **Sign out** on their account
  to cut access at once.
- No single logout: signing out of homeport does not sign you out of the provider.
- Groups are read at sign-in; a change at the provider takes effect on the next sign-in.
