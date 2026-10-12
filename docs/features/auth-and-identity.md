# Auth and identity

## Purpose

Authenticate three separate kinds of people — business users, customers and platform
admins — securely, with immediate revocation, and give customers a frictionless,
passwordless way into one global account.

## Scope

- **In:** user signup/login/2FA/reset/verify; customer OTP login and optional password;
  platform admin login with mandatory 2FA; sessions and revocation; bans; session lists;
  Google sign-in for users (Phase 2); token flow for mobile (Phase 4).
- **Out:** enterprise SSO (SAML/OIDC) — later, as an additional login method; being an
  OAuth provider.
- Decision record: [ADR-0005](../adr/0005-session-auth-with-token-refresh.md). Mechanics:
  [BACKEND.md §6](../../BACKEND.md#6-authentication-and-authorization).

## Concepts

- **Realm:** `user`, `customer`, `platform_admin`. Separate tables, cookies, endpoints and
  session audiences; never interchangeable.
- **Challenge:** a one-time secret (OTP or link) in `auth_challenges`.
- **Identity assurance** (customers in conversations): `none` → `caller_id` →
  `otp_verified` / `session` ([voice-agent](voice-agent.md#identity-and-verification)).

## Business rules

1. Emails are unique per realm (case-insensitive). Phones are unique among active customers.
2. Passwords: 10–256 characters (code points), must not contain the email's local part,
   checked against a breached-password list (Have I Been Pwned range API with k-anonymity
   plus a local list; `PASSWORD_BREACH_CHECK`), hashed with Argon2id (19 MiB, t=2, p=1;
   rehashed on login when the parameters were weaker). No composition rules (NIST SP 800-63B).
3. OTP: 6 digits, valid 10 minutes, max 5 attempts per challenge, max 5 sends per
   destination per hour and 1 per 30 s; responses never reveal whether an account exists.
4. A customer is created on first successful OTP for a new phone/email. If a customer
   record already exists for that contact point (e.g. created from a phone booking), OTP
   login attaches to it and sets `phone_verified_at`.
5. Customers never receive passwords. They may set one from their profile after login
   (requires a fresh OTP step-up) ([FR-AUTH-004](../product/requirements.md#fr-auth--authentication-and-identity)).
6. Users can enable TOTP; organizations with `require_mfa` force enrolment on next login.
   Platform admins must use TOTP.
7. Session lifetimes: users idle 12 h / absolute 30 d; customers idle 30 d / absolute
   90 d; admins idle 30 min / absolute 12 h. Sensitive actions (password change, payout
   settings, provider credentials) require re-authentication within 10 minutes; for
   password change and TOTP enrol/disable the current password is sent with the request.
8. Password change revokes all other sessions of that subject; reset (forgot password)
   revokes all of them. A successful reset also marks the email verified.
9. Banning (by platform admin) sets status `banned`, bumps `session_version`, revokes all
   sessions/refresh families immediately ([FR-AUTH-006](../product/requirements.md#fr-auth--authentication-and-identity)).
10. Customer contact change (new phone/email) requires OTP to the new destination; the
    old destination gets a notice.
11. Merging customer identities happens only when the same person proves control of both
    contact points ([FR-CUS-010](../product/requirements.md#fr-cus--customers)).
12. Links: email verification 24 h, password reset 30 min; single use. Several links may be
    open at once; using one closes the subject's other open links for the same purpose.
13. Lockout: 10 failed password or code checks for one account within 15 minutes refuse
    further logins for that account (from any IP) until the window passes; independently,
    the `auth.login` rate limit allows 10 attempts per IP and account per 15 minutes.
    Second-factor login tokens allow 5 code attempts and live 5 minutes.
14. New-device sign-in alert: emailed when a login comes from a device label (browser + OS)
    the account has not used before. Controlled by the `auth.login_alert_email` feature
    flag (on by default; a `user` override of `false` opts one user out).
15. Organizations that require 2FA (`users.mfa_required`): the session still starts, but
    business endpoints answer `403 mfa_enrollment_required` until TOTP is set up, and TOTP
    cannot be disabled.

## Flows

### 5.1 Customer OTP login (customer app)

```
POST /auth/customers/otp/start   { destination: "+923001234567", channel: "sms" }
  → rate-limit → create auth_challenge (login) → send via notifications (auth.otp template)
  → 202 { challengeId, expiresAt, resendAfter }
POST /auth/customers/otp/verify  { challengeId, code }
  → verify hash, attempts → find-or-create customer → mark contact verified
  → create session (cookie att_c) → 200 { customer, csrfToken }
```

### 5.2 After a phone booking

The voice agent links the booking to the customer matched/created by caller number
(`identity_assurance = caller_id`). The confirmation SMS contains a link to the customer
app. Opening it starts the OTP flow pre-filled with the number; after verification the
customer sees the booking ([FR-CUS-003](../product/requirements.md#fr-cus--customers)).

### 5.3 Widget identification

Before showing or changing existing bookings, the widget runs `widget_identify` OTP
challenges; the resulting verification is attached to the conversation
(`identity_assurance = otp_verified`), not a full customer-app session.

### 5.4 User signup

Signup creates the user (unverified email), sends verification link, creates a session
with limited scope (can create an organization, cannot invite until verified).

### 5.5 User login with a second factor

```
POST /auth/users/login       { email, password }
  → lockout + rate limit → Argon2id verify
  → no TOTP: session (cookie att_u) → 200 { status: "authenticated", user, session, csrfToken }
  → TOTP on: 200 { status: "mfa_required", mfaToken, methods, expiresAt }   (no cookie)
POST /auth/users/mfa/verify  { mfaToken, code } | { mfaToken, recoveryCode }
  → TOTP step accepted once / recovery code burned → session → 200 { user, session, csrfToken }
```

## Data

[`users`](../data-model/01-identity-and-auth.md#users),
[`customers`](../data-model/01-identity-and-auth.md#customers),
[`platform_admins`](../data-model/01-identity-and-auth.md#platform_admins),
[`sessions`](../data-model/01-identity-and-auth.md#sessions),
[`refresh_tokens`](../data-model/01-identity-and-auth.md#refresh_tokens),
[`auth_challenges`](../data-model/01-identity-and-auth.md#auth_challenges),
[`mfa_factors`](../data-model/01-identity-and-auth.md#mfa_factors),
[`oauth_accounts`](../data-model/01-identity-and-auth.md#oauth_accounts).

## API

`{realm}` ∈ `users`, `customers`, `admins`.

| Method | Path | Realms | Purpose |
|---|---|---|---|
| POST | `/auth/users/signup` | user | Create account and sign in |
| POST | `/auth/{realm}/login` | user, admin, customer (if password set) | Password login → may return `mfa_required` |
| POST | `/auth/{realm}/mfa/verify` | user, admin | Complete login with TOTP/recovery code |
| POST | `/auth/customers/otp/start` | customer | Send OTP (login) |
| POST | `/auth/customers/otp/verify` | customer | Verify OTP → session |
| GET | `/auth/{realm}/session` | all | Current subject, session + CSRF token |
| POST | `/auth/{realm}/logout` | all | Revoke current session |
| GET | `/auth/{realm}/sessions` | all | List active sessions |
| DELETE | `/auth/{realm}/sessions/{sessionId}` | all | Revoke one session |
| POST | `/auth/{realm}/sessions/revoke-others` | all | Log out other devices |
| POST | `/auth/{realm}/password/forgot` | user, admin, customer | Send reset link (always `202`) |
| POST | `/auth/{realm}/password/reset` | user, admin, customer | Reset with token |
| POST | `/auth/{realm}/password/change` | all | Change (current password required) |
| POST | `/auth/users/email/verify` | user | Verify email link |
| POST | `/auth/users/email/resend` | user | Send the verification link again |
| POST | `/auth/{realm}/mfa/totp/enroll` · `/confirm` · `/disable` | user, admin | Manage TOTP (enrol and disable require the password) |
| POST | `/auth/{realm}/token` · `/token/refresh` | user, customer | Mobile token flow (Phase 4) |
| GET | `/auth/users/oauth/google/start` · `/callback` | user | Google sign-in (Phase 2) |
| POST | `/me/contact/change/start` · `/verify` | customer | Change phone/email |
| GET · PATCH | `/auth/users/account` | user | Own profile: name, phone, locale, timezone, avatar |
| POST | `/auth/users/account/avatar` | user | Signed upload URL for a new avatar |

The users realm is implemented (A4); exact shapes are in `packages/contracts`
(`routes.userAuth`, `routes.account`) and the generated OpenAPI document. The own-profile
endpoints live under `/auth/users/` because `/v1/me` is the customer audience.

## Events and jobs

Events: `user.signed_up`, `user.email_verification_requested`, `user.email_verified`,
`auth.login_succeeded`, `auth.login_failed` (audit only), `auth.password_reset_requested`,
`auth.password_changed`, `auth.mfa_changed`, `session.revoked`, `subject.banned`,
`customer.created`. Payloads: `packages/contracts/src/events/identity.ts`.

Emails (verification, reset, new-device alert) are sent by the worker's
`auth-notifications` consumer, which mints the link when it handles the event, so tokens
never sit in the outbox.

Jobs: `maintenance/session-cleanup` (marks expired sessions, deletes sessions ended over
30 days ago), `maintenance/challenge-cleanup` (deletes challenges a week after expiry),
both nightly.

## Permissions

Auth endpoints are self-service for the authenticated subject. Banning and session
revocation for others: platform admin `support` or above.

## Edge cases

| Case | Handling |
|---|---|
| Caller ID spoofed or shared family phone | Bookings link to the matched customer, but changing existing bookings by voice requires OTP ([voice-agent](voice-agent.md#identity-and-verification)); the app requires OTP login |
| Customer changes phone number | Old number's bookings stay on the same identity; new number verified by OTP |
| Same email for a user and a customer | Allowed; separate realms |
| OTP delivery fails (SMS blocked) | Offer email or WhatsApp channel; voice-call OTP as last resort |
| Brute-force on OTP | Per-challenge attempt cap + per-destination and per-IP limits; lockout window grows |
| Admin impersonation | Separate session tied to `impersonation_sessions`, banner in UI, audited, read-only by default |

## Requirements covered

FR-AUTH-001 … FR-AUTH-011, NFR-SEC-002, NFR-SEC-005, NFR-SEC-006.
