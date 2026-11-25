# Single sign-on (OpenID Connect)

homeport can let people sign in through your identity provider: Authentik, Authelia, Keycloak,
Pocket ID, Zitadel, or any other OpenID Connect provider. It is off by default. The admin
password keeps working alongside it, so a broken provider never locks you out.

## How access is decided

Signing in at the provider is not enough. homeport reads the person's groups and gives them one
of two roles:

| In a group listed under | Gets |
| --- | --- |
| Admin groups | Full control, the same as the admin password |
| Viewer groups (and no admin group) | A read-only account, created on first sign-in |
| Neither | Turned away, with "not in a group allowed into homeport" |

With no groups configured, nobody gets in through SSO. Viewer accounts appear under
Settings > Security > User accounts with an SSO badge, have no password, and are matched by the
provider's issuer and account id (`sub`), never by email or username, so renaming someone at the
provider does not create a second account and a reused email cannot take over an existing one.
Deleting a viewer account signs it out at once; it is recreated on the next SSO sign-in as long
as the person is still in a viewer group.

Group names are compared without case, and a leading `/` (Keycloak's full group paths) is ignored.

## Setting it up

1. At the provider, create an OpenID Connect client (confidential, authorization code flow) with
   the redirect URI `https://<homeport's address>/api/auth/oidc/callback`. The settings page
   shows the exact value with a copy button once the public URL is filled in.
2. In homeport, open Settings > Security > Single sign-on and fill in homeport's public URL, the
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
  slash). Groups come in the `groups` claim with the `profile` scope. Pick a signing key on the
  provider: without one Authentik signs ID tokens with the client secret (HS256), which homeport
  does not accept.
- **Authelia:** add the `groups` scope to the client. Authelia puts groups in userinfo rather than
  the ID token; homeport reads both.
- **Keycloak:** the issuer is `https://<keycloak>/realms/<realm>`. Add a "Group Membership" mapper
  with claim name `groups`. For client roles instead, set the groups claim to
  `resource_access.<client>.roles`.
- **Pocket ID:** request the `groups` scope.
- **Zitadel:** set the groups claim to `urn:zitadel:iam:org:project:roles` and turn on "Assert
  Roles on Authentication" for the project.

## Security

- The protocol is handled by [openid-client](https://github.com/panva/openid-client): discovery,
  the authorization code flow with PKCE (S256), and ID token validation (signature, issuer,
  audience, expiry, nonce). homeport adds no JWT handling of its own.
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
  stops their next sign-in, not a session they already have: delete their viewer account under
  User accounts (or, for an admin, change the admin password, which ends every session) to cut
  access at once.
- No single logout: signing out of homeport does not sign you out of the provider.
- Groups are read at sign-in; a change at the provider takes effect on the next sign-in.
