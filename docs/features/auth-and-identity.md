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
2. Passwords: min 10 chars, checked against a breached-password list (k-anonymity API or
   local list), hashed with Argon2id.
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
   settings, provider credentials) require re-authentication within 10 minutes.
8. Password change or reset revokes all other sessions of that subject.
9. Banning (by platform admin) sets status `banned`, bumps `session_version`, revokes all
   sessions/refresh families immediately ([FR-AUTH-006](../product/requirements.md#fr-auth--authentication-and-identity)).
10. Customer contact change (new phone/email) requires OTP to the new destination; the
    old destination gets a notice.
11. Merging customer identities happens only when the same person proves control of both
    contact points ([FR-CUS-010](../product/requirements.md#fr-cus--customers)).

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
| POST | `/auth/users/signup` | user | Create account |
| POST | `/auth/{realm}/login` | user, admin, customer (if password set) | Password login → may return `mfa_required` |
| POST | `/auth/{realm}/mfa/verify` | user, admin | Complete login with TOTP/recovery code |
| POST | `/auth/customers/otp/start` | customer | Send OTP (login) |
| POST | `/auth/customers/otp/verify` | customer | Verify OTP → session |
| GET | `/auth/{realm}/session` | all | Current subject + CSRF token |
| POST | `/auth/{realm}/logout` | all | Revoke current session |
| GET | `/auth/{realm}/sessions` | all | List active sessions |
| DELETE | `/auth/{realm}/sessions/{sessionId}` | all | Revoke one session |
| POST | `/auth/{realm}/sessions/revoke-others` | all | Log out other devices |
| POST | `/auth/{realm}/password/forgot` | user, admin, customer | Send reset link |
| POST | `/auth/{realm}/password/reset` | user, admin, customer | Reset with token |
| POST | `/auth/{realm}/password/change` | all | Change (re-auth) |
| POST | `/auth/users/email/verify` | user | Verify email link |
| POST | `/auth/{realm}/mfa/totp/enroll` · `/confirm` · DELETE `/mfa/totp` | user, admin | Manage TOTP |
| POST | `/auth/{realm}/token` · `/token/refresh` | user, customer | Mobile token flow (Phase 4) |
| GET | `/auth/users/oauth/google/start` · `/callback` | user | Google sign-in (Phase 2) |
| POST | `/me/contact/change/start` · `/verify` | customer | Change phone/email |
| GET · PATCH | `/me/account` | user | Own profile: name, locale, timezone, avatar |

## Events and jobs

Events: `user.signed_up`, `user.email_verified`, `auth.login_succeeded`,
`auth.login_failed` (audit only), `session.revoked`, `subject.banned`, `customer.created`.
Jobs: `maintenance/session-cleanup`, `maintenance/challenge-cleanup` (nightly).

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
