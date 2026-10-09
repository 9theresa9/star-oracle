# Shared MySQL deployment design — pending actual host inventory

Date: 2026-10-09. Design only. No server, production account, secret, database privilege, network attachment, or deployment has been changed.

## Scope

Keep the existing HTTPS and standalone SSH-only profiles and their Docker >=28 guard. The new shared-MySQL profile must be separately named and independently validated.

## Runtime topology

- Web: only the dedicated Oracle edge network; only host 127.0.0.1:17777 -> Web:8080 is published.
- API: exactly edge and Oracle private backend, unchanged exact Web peer and interface guards.
- Redis: dedicated Oracle backend and dedicated persistent volume, authentication mandatory.
- External MySQL: exactly one operator-selected, currently verified container joins Oracle backend at the reviewed fixed IP/alias. Its pre-existing networks, routes, volumes, limits, identity and lifecycle stay externally owned. Neither Web nor API joins another application's network.
- The launcher validates the external full container ID, image ID/digest, expected original network IDs/endpoints, backend address/alias, MySQL server UUID/version, database name, CURRENT_USER, and explicit grants. It never connects/disconnects, starts/stops, recreates, relabels or deletes external MySQL, including failure cleanup.
- Actual subnet conflicts and the existing MySQL default route must be checked before choosing final constants. Gateway priority may only be used after the upgraded actual Engine/API supports it; inspect the route after the separately approved network attachment. Do not assume a name or source hostname implies network isolation.
- No generic host URL or arbitrary external endpoint allowlist. Only the reviewed topology is accepted; drift fails before ingress starts.

## Resource and lifecycle constraints

Standing container memory caps: API 512 MiB + Redis 192 MiB + Web 128 MiB = 832 MiB. These are configured caps, not measured server consumption. Shared MySQL remains within its existing externally owned cap; new workload still consumes that same server budget.

Migration/account maintenance holds one exclusive host lock and stops Oracle API/Web before the one-shot worker starts. Migration cap 512 MiB, dump/import client cap 128 MiB; large workers do not overlap. The original database stays running. API database pool remains small. No new background proxy/daemon and no second MySQL server image in the runtime bundle. Maintenance MySQL client is an independently pinned, reviewed client-only image from official packages; validate its flags and image inventory in CI.

## Accounts and schema contract

- Main schema uses an ASCII alphanumeric name such as staroracle to avoid underscore/percent database-GRANT wildcard ambiguity. Do not change the shared server's global partial_revokes setting.
- App: SELECT, INSERT, UPDATE, DELETE on the exact schema, exact reviewed source address; no DDL/global privileges/roles/GRANT OPTION/PROXY.
- Migrator: only the exact schema, DML plus CREATE/ALTER/INDEX/REFERENCES required by committed migrations. Future DROP or other extra privilege requires a reviewed migration decision; Prisma migrate deploy, never dev/reset/shadow database.
- Offline account maintenance: a separately reviewed source identity/credential mapping with only app DML. Retain hidden password input, Better Auth hashing/relations, privilege preservation and explicit session revocation.
- Dump: SELECT only, exact source and schema. Trusted provisioning audit confirms no views/triggers/events/routines outside the supported schema model. A zero count from a SELECT-only user is not evidence those hidden objects do not exist.
- Candidate restore: operator-precreated NEW empty schema and credentials restricted solely to it. Importer may need DROP within that candidate for historical mysqldump DROP IF EXISTS compatibility, but has zero access to the original or other application schemas. Candidate migrator and app credentials are scoped independently. No global CREATE/DROP, FILE, SUPER, PROCESS or dynamic admin grants.
- Refuse existing fallback %-host accounts, role-derived/global grants, wildcard schema grants, or unverifiable identity. Actual account creation/grants and persistent credentials are separate operator-approved actions.

## Backup and restore

Dump explicitly one schema, tables only, with single-transaction, quick, no-tablespaces, set-gtid-purged=OFF, skip-triggers, skip-lock-tables, skip-add-drop-table, skip-add-locks, skip-disable-keys. No root, all-databases, routines/events, or production lifecycle control. SQL only flows to gzip and age; publish ciphertext only after the whole pipeline succeeds. No password in args/logs or ambient client config.

Restore completes age authentication, gzip verification and bounded full decompression into private temporary storage before any DB connection. Import with binary mode and local-infile disabled, no ambient defaults, no --force. Verify the candidate is empty using its own identity. Cross-schema USE, file writes, triggers/routines and client shell commands must fail harmlessly with candidate-only credentials. Original schemas remain untouched.

Then deploy committed migrations, verify migration status and actual schema diff, revoke recovered sessions/challenges/trusted devices using the existing offline cutover operation, and validate decryptability/ownership with the original data key. Use a fresh candidate Redis volume and isolated candidate application configuration; never production Redis FLUSH. Revoke any validation sessions again before a separately approved cutover. Failures stop only owned candidate workers, retain diagnostic evidence, and never switch traffic or damage old data. Same-server import can affect availability, so bounded resources and a maintenance window remain necessary.

## TDD and CI acceptance matrix

1. Config: malicious URL/userinfo/query/host/port/schema, wildcard grants, wrong external ID/digest/UUID, unexpected endpoint/alias/mount, daemon direct routing/firewall disablement, public ports, resource drift, lock contention and route changes all reject before ingress.
2. Nonownership: fake external MySQL plus separate synthetic Journal schema/sentinel/session; validate no external start/stop/rm/network-connect/disconnect command on success or every injected failure.
3. Grants: app DML works; DDL/other schema/FILE/local infile denied. Migrator works only on designated schema. Dump works with SELECT-only and cannot inspect/modify other schemas. DBA audit includes a hidden-trigger negative fixture.
4. Network: inspect real Docker bindings and both IP families; public/LAN path denied, host loopback allowed, Web cannot reach DB/Redis, unrelated same/cross-bridge peers with valid Host cannot call API; header spoofing remains rejected. Exact target Engine version and actual Compose command compatibility recorded.
5. Backup: partial pipeline never publishes; damaged age/gzip creates no DB connection; correct dump restores only a fresh candidate; historical migration state has no residual new-version tables; malicious cross-schema SQL fails while original and synthetic Journal hashes/sessions remain unchanged.
6. Maintenance: API/Web stopped before migrator/offline CLI; no concurrent large worker; stop failure prevents work; external MySQL/Journal remain healthy; all own test workers clean up.
7. Application: original unit/API/browser/TOTP/cross-tab A-B-A/idempotency/privacy tests, actual shared-stack username login and backup/candidate recovery, no real SMTP/model calls/secrets.
8. Release: export only exact tested images including API/Web/Redis/client, omit second MySQL server, record commit/tree/image IDs/platform/proof and all checksums. Full actual server inventory, approved privileges and secure secret handoff remain deployment prerequisites.

## Required fresh host input

Exact Engine/Compose after approved upgrade; external container/image identity; existing mounts/networks/routes; candidate subnet availability; MySQL server identity and grant audit; available resource/backup headroom. Historical host names or subnet values are not substituted for these observations. Until then, code may use synthetic constants in an isolated CI fixture but the real topology is not approved or deployable.
