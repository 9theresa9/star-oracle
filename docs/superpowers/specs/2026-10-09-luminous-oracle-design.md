# 照见：清透观星体验与可靠性修订

## Goal and authorization
Preserve every feature at `2a1c0c841a7bf55dec2490a1b24482a755dfb0d3`, improve the entire account and navigation experience using the approved 简章 reference, and close six reviewed reliability/privacy gaps before deployment review. The owner authorized ordinary design decisions and cloud-only implementation without repeated design approval. This change does not deploy or alter main/PR4.

## Design
A daylight observatory: mist blue `#edf5fa`, paper white `#ffffff`, deep blue ink `#203f51`, muted blue `#59717f`, instrument blue `#407da0`, pale horizon `#c8dfed`. Chinese Songti serif headings with quiet system sans-serif controls. Spacious book-like reading pages, translucent navigation/chrome, opaque readable form content. A single original orbital/sea-horizon composition makes 照见 distinct; do not reuse the life-album photographs. Desktop account uses an editorial illustration and a focused form; mobile keeps the form first and navigation reachable. Maintain clear keyboard focus, 44px controls, 16px mobile inputs and reduced motion.

## Reliability boundaries
1. Every private request captures a verified actor/session binding plus local generation. Cross-tab authentication changes revoke identity, abort requests and discard private caches and mounted drafts. Backend rejects mismatching expected actor/session; response application requires the captured generation to remain current.
2. URLs, query strings and Referer never enter access logs. Authentication links leave browser location promptly, with strict referrer policy and log rotation.
3. Unknown follow-up outcomes reuse their immutable request ID. Terminal failures are distinguished before allowing a new paid attempt.
4. Completed model results can rebuild failed conversation projections only through encrypted immutable input and a concrete conversation binding.
5. Reading and AI callbacks require current owner, reading ID and exploration generation.
6. Backups are fully authenticated/decompressed before any database import. Restore uses a new isolated project/schema/volume, migrates and validates, then documents an explicit operator switch; original data remains intact.

## Feature preservation acceptance
- Tarot: all 78 cards, 32 spreads, 15 topics, shuffle, reversals, reveal controls.
- I Ching: coins/numbers/Shanghai civil time; original and changed hexagrams, moving lines, mutual/opposite/reversed forms.
- Knowledge: 78/64 library, all tutorials, fixed-source basic interpretation.
- AI: initial interpretation, same-reading follow-ups, weekly/monthly reviews, explicit consent, persistent quotas, no real provider call in tests.
- Personal: daily card, mood/calendar, diary, pagination/search, favorites/tags/private notes, actions, reports/deletion, full export.
- Accounts: signup/verification/reset, TOTP/recovery, signout/delete, privacy; administrator 2FA remains mandatory.
- Operations: shared-only admin records, feedback/replies, content drafts/publishing, trends, memberships/redemptions/ledger; cash payments remain unavailable.
- Infrastructure: React 19/Vite, NestJS 11/Prisma, MySQL 8.4/Redis 7.4; production HTTPS/SMTP/verified-email/SecureCookie remain enforced.

## Evidence and release gate
Reproduce each defect before claiming its repair. Run typecheck, build, full domain/API suite, browser desktop/mobile flows, two-tab switches, delayed/failed requests and corruption/old-schema restore tests. Capture actual browser screenshots. Clearly separate passed, failed and blocked checks. No production deployment, real secrets or external model/SMTP calls.
