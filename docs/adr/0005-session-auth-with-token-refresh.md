# ADR-0005 · Own authentication: sessions for web, short JWT + rotating refresh for mobile

**Status:** Accepted · 2026-10-11

## Context

Three identity realms (users, customers, platform admins). Requirements: immediate
revocation and banning, "log out other devices", passwordless OTP for customers, 2FA for
staff and admins, and future native mobile apps. The team prefers to own auth rather than
use a hosted provider.

## Decision

- **Web apps:** opaque, random session ids in `HttpOnly; Secure; SameSite=Lax` cookies,
  one cookie per realm; sessions stored hashed in Postgres with a Redis hot copy; CSRF
  synchronizer tokens. Revocation is immediate.
- **Mobile/CLI (Phase 4):** short-lived (10 min) signed access JWTs bound to a session id,
  plus single-use rotating refresh tokens with family reuse detection. A Redis revocation
  set for session ids cuts access within one request.
- **Bans:** subject status + `session_version` bump + revoke all sessions/families.
- Argon2id passwords, hashed OTPs/links in `auth_challenges`, TOTP 2FA, rate limits.
- We are an OAuth **client** (Google sign-in, calendar access), not an OAuth provider.

## Alternatives considered

- **JWT-only (stateless).** Cannot revoke before expiry without extra infrastructure;
  tokens in browser storage are exposed to XSS. Rejected for web.
- **Hosted auth (Auth0, Clerk, WorkOS).** Faster start; rejected by preference for owning
  identity, cost at scale, and the custom customer/OTP model. Can still be added for
  enterprise SSO (SAML/OIDC) as an additional login method.

## Consequences

- We own security-critical code: it gets dedicated tests, rate limiting and audits.
- Session lookup is one Redis read per request; Postgres is the durable source.
