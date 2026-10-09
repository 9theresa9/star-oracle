# Luminous Oracle Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task; narrowly independent backend/infrastructure work may be delegated to workers. Integration remains with one owner.

**Goal:** Preserve all original features, refresh account/app UI, and close reviewed identity, log, AI and restore gaps.
**Architecture:** Keep existing React/Nest interfaces. Add actor/session generation protection centrally, immutable model recovery, safe restore staging and coherent daylight styles.
**Tech Stack:** React 19, Vite, NestJS 11, Prisma, MySQL 8.4, Redis 7.4.
**Spec:** docs/superpowers/specs/2026-10-09-luminous-oracle-design.md

## Global Constraints
- Cloud isolated checkout only; no user computer, production server, merge, force push, real secrets or AI calls.
- Preserve production HTTPS, SMTP, verified-email, SecureCookie and administrator 2FA.
- Every feature in the spec's preservation inventory remains reachable with real API contracts.

## Review Focus
- Same account re-login is a new session; stale drafts/results must not survive merely because actor ID matches.
- Visibility/focus resumption and absent BroadcastChannel/storage must remain fail-closed for private writes.
- A request can succeed server-side and fail client-side; retries must not increase model calls or quota.
- TOTP recovery/reset modes must mask sensitive fields and purge temporary values after leaving their mode.
- Corrupt/old-schema backups must never alter the currently running database.

### Task 1: Verified session boundaries
Files: web lib/session.tsx, lib/api.ts, new lib/session-identity.ts; api security.ts/main.ts; contracts type; session regressions and browser tests.
- [ ] Write identity revocation/late-response/expected-actor failing tests.
- [ ] Verify failure against old behavior.
- [ ] Bind private requests to verified actor/session/generation; abort and remount private state on revocation; broadcast authentication transitions.
- [ ] Verify focused, typecheck and full suites; commit.

### Task 2: Safe access logging and isolated restoration
Files: infra/nginx.conf, compose logging, scripts backup/restore, operations docs and shell tests.
- [ ] Reproduce token logging/config and streaming-corruption/old-schema unsafe behavior.
- [ ] Remove URL/referrer logging, set no-referrer and bounded rotation.
- [ ] Authenticate/decompress to restricted files, restore only into new target, migrate/validate and require deliberate operator switch.
- [ ] Verify corruption leaves original target untouched; record container execution limitations; commit.

### Task 3: Recoverable AI attempts
Files: api model/oracle services, schema/additive migration, web explore, regression tests.
- [ ] Reproduce failed projection with done AI cache and immutable identity collision tests.
- [ ] Persist encrypted input snapshot and conversation association; restore only a matching completed result.
- [ ] Keep client request IDs during unknown outcomes and guard old reading callbacks.
- [ ] Verify one model call/one quota use for lost-response recovery and delayed A after new B; commit.

### Task 4: Luminous account and app experience
Files: account.tsx/account.css, main.tsx/styles.css, home.tsx, existing feature styles; browser tests/screenshots.
- [ ] Extend account navigation/form accessibility coverage before rewrite.
- [ ] Implement responsive editorial account panel and original observatory artwork, matching app navigation/form/reading palette.
- [ ] Preserve every auth mode and account/admin action, mask password/OTP/recovery secrets, scrub URL tokens.
- [ ] Validate desktop/390px/320px, keyboard, reduced motion, loading/errors; commit.

### Task 5: Whole-branch release review
- [ ] Run production typecheck/build, full tests and real browser workflows against disposable MySQL/Redis.
- [ ] Gather screenshots, feature comparison, known limitations and deployment prerequisites.
- [ ] Independent whole-branch review; repair important findings with reproducing tests.
- [ ] Push authorized new branch, create draft PR, verify exact commit CI; no merge/deployment.
