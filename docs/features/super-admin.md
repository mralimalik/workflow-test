# Super-admin console

## Purpose

Let Attendra staff operate the platform: manage tenants, plans and offers, AI and
telephony providers and which tenants use which models, feature flags, and support
cases — safely and with a full audit trail.

## Scope

- **Phase 1:** organizations (view/suspend), provider credentials, model profiles and
  assignments, feature flags, admin users and roles.
- **Phase 2:** plans/prices/coupons/promotion codes, impersonation, platform health and
  usage dashboards, phone number inventory, industry templates.
- Separate app (`apps/admin`), separate realm and origin ([ADR-0010](../adr/0010-frontend-apps.md)).

## Admin roles

| Role | Can |
|---|---|
| `super_admin` | everything, incl. provider credentials, admin users, full impersonation |
| `support` | view tenants, read-only impersonation, revoke sessions, ban, extend grace periods |
| `billing` | plans, prices, coupons, promotion codes, entitlement overrides, invoices |
| `read_only` | view everything except secrets |

## Providers and model profiles

1. Create a **provider credential**: kind, provider, non-secret config (endpoint,
   API version, region, deployment resource), secret. The secret is write-only; the UI
   shows the fingerprint. "Verify" runs a connectivity check.
2. Create **model profiles** on a credential: modality, model/deployment, voice,
   parameters, cost rates, optional fallback profile.
3. **Assign** profiles to scopes: platform default, plan, organization, location or
   channel endpoint, per modality, with rollout percentage (A/B or gradual migration).
4. Changes take effect for **new** conversations; caches are invalidated by
   `model_profile.*` / `profile_assignment.changed` events; active calls finish on their
   profile.
5. Health: per profile error rate and latency; circuit breaker flips to fallback; admins
   see incidents.
6. BYOK (later): organizations on plans with `features.byok` create their own credentials
   and profiles in the dashboard; admins can see that BYOK is in use but not the secret.

## Business rules

1. Every admin action is audited with actor `platform_admin`; tenant-affecting actions
   are visible to the organization's owners in their audit log (e.g. "Attendra support
   viewed your account").
2. Impersonation requires a reason, is time-boxed (≤ 60 min), read-only unless
   `super_admin` chooses `full`, and shows a banner to the admin.
3. Suspending an organization requires a reason and notifies owners.
4. Deleting provider credentials in use is blocked; disable first and reassign profiles.

## Data

[`platform_admins`](../data-model/01-identity-and-auth.md#platform_admins),
[`impersonation_sessions`](../data-model/01-identity-and-auth.md#impersonation_sessions),
[`provider_credentials`](../data-model/11-agents-and-ai.md#provider_credentials),
[`ai_model_profiles`](../data-model/11-agents-and-ai.md#ai_model_profiles),
[`ai_profile_assignments`](../data-model/11-agents-and-ai.md#ai_profile_assignments),
[billing tables](../data-model/09-platform-billing.md),
[`feature_flags`](../data-model/14-system.md#feature_flags),
[`audit_logs`](../data-model/14-system.md#audit_logs).

## API

All under `/admin`, platform admin session with 2FA.

| Method | Path | Role |
|---|---|---|
| GET | `/admin/organizations?q=&status=&plan=` · `/admin/organizations/{id}` | read_only+ |
| POST | `/admin/organizations/{id}/suspend` · `/reactivate` · `/grace-extension` | support+ |
| GET | `/admin/users?q=` · `/admin/customers?q=` | support+ |
| POST | `/admin/{realm}/{id}/ban` · `/unban` · `/revoke-sessions` | support+ |
| POST | `/admin/impersonations` · DELETE `/admin/impersonations/{id}` | support+ (full: super_admin) |
| GET · POST · PATCH · DELETE | `/admin/provider-credentials[/{id}]` | super_admin (read: read_only+) |
| POST | `/admin/provider-credentials/{id}/verify` · `/rotate-secret` | super_admin |
| GET · POST · PATCH · DELETE | `/admin/model-profiles[/{id}]` | super_admin |
| GET · POST · PATCH · DELETE | `/admin/profile-assignments[/{id}]` | super_admin |
| GET · POST · PATCH | `/admin/plans[/{id}]`, `/admin/plans/{id}/prices`, `/admin/plans/{id}/allowances` | billing+ |
| POST | `/admin/plan-prices/{id}/supersede` | billing+ (price change + migration policy) |
| GET · POST · PATCH | `/admin/coupons[/{id}]`, `/admin/promotion-codes[/{id}]` | billing+ |
| GET · POST · DELETE | `/admin/organizations/{id}/entitlement-overrides` | billing+ |
| GET · POST · PATCH | `/admin/feature-flags[/{id}]`, `/admin/feature-flags/{id}/overrides` | super_admin |
| GET | `/admin/phone-numbers?status=` | support+ |
| GET · PUT | `/admin/templates[/{key}]` (industry templates) | super_admin |
| GET | `/admin/audit-logs?actor=&organizationId=&action=` | read_only+ |
| GET | `/admin/health` · `/admin/usage?from=&to=` | read_only+ |
| GET · POST · PATCH | `/admin/admins[/{id}]` | super_admin |

## Events and jobs

Emits `model_profile.updated`, `profile_assignment.changed`, `feature_flag.updated`,
`organization.suspended`, plan/price events consumed by billing sync.

## Edge cases

| Case | Handling |
|---|---|
| Admin assigns a profile lacking a language an org uses | Assignment validation warns using `capabilities.languages` |
| Credential secret leaked | `rotate-secret` re-encrypts new secret; old one revoked at the provider |
| Two assignments at same scope with rollout not summing to 100 | Rejected by validation |

## Requirements covered

FR-ADM-001 … FR-ADM-007, FR-AGT-009, FR-AGT-010.
