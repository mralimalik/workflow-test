# 01 · Identity and authentication

Three identity realms, each its own table, sharing one set of auth tables keyed by
`(subject_type, subject_id)`. Behaviour: [features/auth-and-identity.md](../features/auth-and-identity.md).
Conventions ([base], [soft] …): [README §1](README.md#1-conventions).

```
platform_admins ─┐
users ───────────┼──► sessions ──► refresh_tokens
customers ───────┘       ▲
     auth_challenges · mfa_factors · oauth_accounts  (subject_type + subject_id)
```

`subject_type` values everywhere in this file: `platform_admin` | `user` | `customer`.
Polymorphic `subject_id` has no FK; integrity is enforced by the auth module, and each
realm's deletion path cleans its rows.

---

## platform_admins

Attendra staff. Never members of organizations. **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `email` | citext | no | | UNIQUE |
| `name` | text | no | | |
| `password_hash` | text | no | | Argon2id |
| `role` | text | no | | `super_admin` \| `support` \| `billing` \| `read_only` |
| `status` | text | no | `'active'` | `active` \| `disabled` |
| `mfa_enforced` | boolean | no | `true` | always true; column exists for audits |
| `session_version` | integer | no | `1` | bump to invalidate all tokens ([BACKEND §6.2](../../BACKEND.md#62-revocation-and-bans)) |
| `last_login_at` | timestamptz | yes | | |

Constraints: UNIQUE `email`; role and status CHECKs; `CHECK (mfa_enforced)`. Created only by
the `admin:create` CLI or a super admin; the initial `password_hash` is a hash of a random
value that nobody knows, replaced when the invitee sets a password through the link.

## users

Business-side people who log in to the dashboard. Global: one user may belong to many
organizations through `memberships`. **[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `email` | citext | no | | UNIQUE |
| `email_verified_at` | timestamptz | yes | | |
| `phone_e164` | text | yes | | for staff alerts; not a login identifier |
| `password_hash` | text | yes | | null when only OAuth is used |
| `first_name` | text | no | | |
| `last_name` | text | yes | | |
| `avatar_file_id` | uuid | yes | | FK → `files` |
| `locale` | text | no | `'en'` | UI language |
| `timezone` | text | yes | | personal display preference |
| `status` | text | no | `'active'` | `active` \| `disabled` \| `banned` |
| `banned_at` | timestamptz | yes | | |
| `ban_reason` | text | yes | | |
| `session_version` | integer | no | `1` | |
| `last_login_at` | timestamptz | yes | | |
| `mfa_required` | boolean | no | `false` | true if any organization they belong to requires MFA (denormalized, maintained by access module) |

Constraints: UNIQUE `email`; `CHECK (status IN …)`; `phone_e164` matches E.164; `session_version >= 1`.

## customers

End customers. **One global identity across all organizations**
([FR-CUS-001](../product/requirements.md#fr-cus--customers)). What each organization
knows about a customer lives in [`customer_profiles`](03-customers.md#customer_profiles).
**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `phone_e164` | text | yes | | Primary phone. UNIQUE where not null |
| `phone_verified_at` | timestamptz | yes | | Set only by OTP verification; caller ID alone does **not** verify |
| `email` | citext | yes | | UNIQUE where not null |
| `email_verified_at` | timestamptz | yes | | |
| `password_hash` | text | yes | | Optional; customers log in by OTP by default ([FR-AUTH-004](../product/requirements.md#fr-auth--authentication-and-identity)) |
| `first_name` | text | yes | | as given by the customer |
| `last_name` | text | yes | | |
| `locale` | text | yes | | preferred language |
| `timezone` | text | yes | | |
| `avatar_file_id` | uuid | yes | | FK → `files` |
| `status` | text | no | `'active'` | `active` \| `banned` \| `deleted` |
| `banned_at` | timestamptz | yes | | platform-level ban (abuse) |
| `session_version` | integer | no | `1` | |
| `merged_into_id` | uuid | yes | | FK → `customers`; set when this identity was merged ([FR-CUS-010](../product/requirements.md#fr-cus--customers)) |
| `anonymized_at` | timestamptz | yes | | privacy deletion: PII columns nulled, row kept for referential integrity |
| `last_login_at` | timestamptz | yes | | |

Constraints:
- `CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL OR anonymized_at IS NOT NULL)`
- Partial unique indexes on `phone_e164` and `email` `WHERE merged_into_id IS NULL AND anonymized_at IS NULL`.

Notes:
- A customer created from an inbound call has `phone_e164` set and `phone_verified_at`
  null until they verify by OTP. Bookings made on the call are linked immediately; the
  customer app shows them after OTP login with that number.
- Additional contact points (second phone, work email) are a future table
  `customer_contact_points`; not needed for v1.

## sessions

One row per login (any realm, any client type). Web cookies hold the raw id; the DB
holds only its hash. Hot copy cached in Redis ([BACKEND §9.2](../../BACKEND.md#92-cache-catalogue)).
**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `token_hash` | bytea | no | | SHA-256 of the session id. UNIQUE |
| `subject_type` | text | no | | `platform_admin` \| `user` \| `customer` |
| `subject_id` | uuid | no | | |
| `client_type` | text | no | | `web` \| `mobile` \| `cli` |
| `auth_method` | text | no | | `password` \| `otp_sms` \| `otp_email` \| `otp_whatsapp` \| `magic_link` \| `oauth_google` \| `refresh` |
| `mfa_verified_at` | timestamptz | yes | | step-up state |
| `csrf_secret` | bytea | yes | | web sessions only |
| `subject_version` | integer | no | | copy of subject `session_version` at login |
| `ip` | inet | yes | | at creation |
| `user_agent` | text | yes | | |
| `device_label` | text | yes | | "Chrome on macOS" — for session lists |
| `impersonation_session_id` | uuid | yes | | FK → `impersonation_sessions` when an admin acts as a user |
| `last_seen_at` | timestamptz | no | `now()` | updated at most once per minute |
| `idle_expires_at` | timestamptz | no | | sliding |
| `absolute_expires_at` | timestamptz | no | | hard cap |
| `revoked_at` | timestamptz | yes | | |
| `revoke_reason` | text | yes | | `logout` \| `logout_all` \| `password_changed` \| `banned` \| `admin` \| `expired` \| `reuse_detected` |

Indexes: UNIQUE `token_hash`; `(subject_type, subject_id) WHERE revoked_at IS NULL`;
`(absolute_expires_at)` for cleanup. Checks: `revoked_at` and `revoke_reason` are set
together; `idle_expires_at <= absolute_expires_at`. The CSRF token handed to the client is
`base64url(csrf_secret)`. Sessions ended more than 30 days ago are deleted nightly.

## refresh_tokens

Rotating refresh tokens for token-based clients (mobile, CLI). Each use issues a new
token in the same family; reuse of a used token revokes the whole family and the session.
**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `session_id` | uuid | no | | FK → `sessions` ON DELETE CASCADE |
| `family_id` | uuid | no | | all rotations of one login |
| `token_hash` | bytea | no | | UNIQUE |
| `parent_id` | uuid | yes | | FK → `refresh_tokens` (rotated from) |
| `expires_at` | timestamptz | no | | |
| `used_at` | timestamptz | yes | | set on rotation |
| `revoked_at` | timestamptz | yes | | |

## auth_challenges

Every one-time secret: OTP codes, magic links, email verification, password reset,
invitation acceptance for new users, phone change verification. One table, one flow
([FR-AUTH-003](../product/requirements.md#fr-auth--authentication-and-identity), [FR-AUTH-010](../product/requirements.md#fr-auth--authentication-and-identity)).
**[base-append]** + `updated_at`

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `kind` | text | no | | `otp` \| `link` |
| `purpose` | text | no | | `login` \| `verify_phone` \| `verify_email` \| `password_reset` \| `change_email` \| `change_phone` \| `widget_identify` \| `mfa_recovery` |
| `realm` | text | no | | `platform_admin` \| `user` \| `customer` |
| `subject_id` | uuid | yes | | null when the subject does not exist yet (first login creates it) |
| `channel` | text | no | | `sms` \| `whatsapp` \| `email` \| `voice` |
| `destination` | text | no | | E.164 or email (normalized) |
| `secret_hash` | bytea | no | | HMAC-SHA-256 of code/link token with server pepper |
| `attempts` | smallint | no | `0` | |
| `max_attempts` | smallint | no | `5` | |
| `expires_at` | timestamptz | no | | OTP 10 min; links: verify email 24 h, password reset 30 min |
| `consumed_at` | timestamptz | yes | | |
| `context_organization_id` | uuid | yes | | context (e.g. widget of org X) for branding the message. Named so it is not mistaken for a tenant key: this table is global and has no RLS |
| `ip` | inet | yes | | |
| `context` | jsonb | no | `'{}'` | e.g. `{ "conversationId": "..." }` for widget identification |

Indexes: UNIQUE `secret_hash` `WHERE kind = 'link'` (links are looked up by hash);
`(destination, purpose, created_at DESC)`; `(realm, subject_id, purpose)`; `(expires_at)`
for cleanup (deleted 7 days after expiry). Links are consumed by one conditional `UPDATE`
(single use under concurrency); `max_attempts` is 1 for links.

## mfa_factors

**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `subject_type` | text | no | | `platform_admin` \| `user` |
| `subject_id` | uuid | no | | |
| `type` | text | no | | `totp` \| `recovery_codes` (WebAuthn later) |
| `secret_ciphertext` | bytea | no | | TOTP: envelope-encrypted secret, AAD `mfa_factors:<id>`. Recovery codes: concatenated 32-byte HMACs of the (normalized) codes; a used code's HMAC is removed |
| `label` | text | yes | | |
| `verified_at` | timestamptz | yes | | factor is active only when verified |
| `last_used_at` | timestamptz | yes | | |
| `last_used_step` | bigint | yes | | TOTP replay protection |

UNIQUE `(subject_type, subject_id, type) WHERE verified_at IS NOT NULL` (one active TOTP
and one active recovery-code set per subject). An unverified TOTP factor expires 15 minutes
after enrolment starts; starting again replaces it.

## oauth_accounts

External identity links ("Sign in with Google"). Calendar authorizations are **not**
stored here — they are organization integrations ([13](13-integrations.md#integration_connections)).
**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `subject_type` | text | no | | `user` \| `customer` |
| `subject_id` | uuid | no | | |
| `provider` | text | no | | `google` \| `apple` \| `microsoft` |
| `provider_subject` | text | no | | provider's stable user id |
| `email` | citext | yes | | as asserted by provider |
| `email_verified` | boolean | no | `false` | |
| `last_login_at` | timestamptz | yes | | |

UNIQUE `(provider, provider_subject)`; UNIQUE `(subject_type, subject_id, provider)`.

## impersonation_sessions

Audited "log in as" for support ([FR-ADM-004](../product/requirements.md#fr-adm--platform-administration)).
**[base]**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `platform_admin_id` | uuid | no | | FK → `platform_admins` |
| `target_user_id` | uuid | no | | FK → `users` |
| `organization_id` | uuid | no | | FK → `organizations`; impersonation is limited to one organization |
| `reason` | text | no | | mandatory free text / ticket ref |
| `access_level` | text | no | `'read_only'` | `read_only` \| `full` (full requires `super_admin`) |
| `started_at` | timestamptz | no | `now()` | |
| `expires_at` | timestamptz | no | | max 60 min |
| `ended_at` | timestamptz | yes | | |
