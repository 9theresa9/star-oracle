# SSH-only with an externally managed MySQL instance

This opt-in profile keeps formal accounts and data in a dedicated schema on an existing MySQL 8.4 server. It uses a dedicated Redis volume and keeps the same username/password, TOTP, CSRF, actor/session isolation and closed registration/email endpoints. The independent HTTPS and standalone SSH profiles remain available.

Only Web publishes a host port, exactly `127.0.0.1:17777:8080`. Use an SSH client local forward bound to `127.0.0.1:17777` and open `http://localhost:17777`. HTTP is intentional only in this SSH-only mode; default public production still requires HTTPS/Secure Cookies. The browser-to-local-tunnel hop is not TLS. Local malicious processes and other services on the same browser's localhost can affect cookies, which are not isolated by port. Root or a Docker administrator can change the deployment boundary; this profile does not prevent an administrator from adding a public proxy.

## Requirements

Use a maintained stable rootful Linux Docker Engine version at least 28, compatible Docker Compose plugin, Node.js 24, `flock`, `age`, and sufficient private temporary storage for recovery. The launcher connects only to the local Unix Docker socket. Do not enable direct routing, `nat-unprotected`, disable Docker firewall rules, or switch to an unverified firewall backend. The server must have a tested backup/rollback procedure before changing the Engine itself.

The fixed Oracle edge/backend ranges are `172.30.77.0/24` and `172.30.78.0/24`; the launcher refuses conflicts. The standalone and shared SSH profiles cannot run together. Web uses only edge; API uses edge and private backend; Redis uses only backend. The existing MySQL container is attached separately to backend at `.4`, alias `oracle-mysql`, while retaining its original networks and default route. Web/API never join another application's network.

The four service caps are API 512 MiB, Web 128 MiB, Redis 192 MiB, and an offline migrator 512 MiB. Standing total is 832 MiB; swap limits equal memory limits. Migration and account maintenance stop API/Web and hold one host lock. Client-only dump/import workers use 128 MiB; candidate offline validation uses at most 512 MiB plus a fresh 64 MiB Redis, while the main Redis remains 192 MiB. These are configured limits, not a guarantee of host headroom or measured consumption. The existing shared database's memory/connection/disk budget still needs operator review.

## Verified offline release

The CI bundle contains exactly the tested API, Web, Redis and MySQL client-only images. It does not contain or create another MySQL server. `ssh-shared-manifest.json` binds the exact source commit/tree, image IDs, platform, executed checks and file hashes. Verify the artifact's independently obtained SHA-256, then:

```sh
node scripts/ssh-shared-release.mjs verify /absolute/release
node scripts/ssh-shared-release.mjs load /absolute/release
```

Loading imports the checked images; it does not build images, publish to a registry, create credentials, connect the external database, or start the application. Use only a native-platform artifact whose exact-head CI completed successfully. Do not substitute the standalone four-image bundle or mix launcher files from different revisions.

## Private configuration and provisioning

Copy `.env.ssh-shared.example` and `docs/examples/ssh-shared-input.example.json` outside the release/repository. Both final files must be regular, non-symlink, single-link files owned by the account running the launcher and readable only by that account. Empty examples intentionally fail validation. Credentials are supplied securely by the operator; never put them in chat, command arguments, source control, screenshots or logs.

Database/cache/data secrets are independent 64-character hexadecimal values. Preserve an existing `AUTH_SECRET` byte-for-byte when retaining accounts and TOTP; use canonical `AUTH_SECRET_BASE64` instead of `AUTH_SECRET` when needed. Preserve the original `DATA_ENCRYPTION_KEY`; do not rotate it merely to move profiles. Existing accounts are not reset, promoted or reverified by this profile.

The private JSON requires:

- Full external container ID, exact image ID, observed MySQL server UUID and exact 8.4 patch version
- Every original network's name/ID, IPv4 address/prefix, gateway and aliases
- Original default route `{gateway, interface}`, or explicit `null` when none exists
- A trusted provisioning audit for schema `staroracle`, bound to the same UUID, confirming tables only, no anonymous/fallback accounts, and no roles or additional grants

The audit is an operator/DBA statement based on privileged inspection. Restricted `SHOW GRANTS` and a zero count in information_schema cannot independently prove that hidden objects or alternate accounts do not exist. Refresh the audit after relevant DBA changes. The application checks its own real connection identity and exact grants on each shared entrypoint, including bare `SHOW GRANTS`, `CURRENT_USER`, active/mandatory roles, database, UUID and version.

Create these new, source-bound accounts securely; never modify existing applications' accounts or grant global privileges:

| Role | Exact connecting source | Schema permissions |
| --- | --- | --- |
| `staroracle_app` | `172.30.78.2` | SELECT, INSERT, UPDATE, DELETE |
| `staroracle_migrator` | `172.30.78.6` | App permissions plus CREATE, ALTER, INDEX, REFERENCES |
| `staroracle_backup` | `172.30.78.7` | SELECT |
| `staroracle_maintenance` | `172.30.78.7` | App permissions |

The schema name is `staroracle` without SQL wildcard characters. No `%` fallback host, roles, GRANT OPTION, PROXY, global/table/column grants or unrelated privileges are accepted. The migrator uses only committed `migrate deploy`; it does not use a shadow database, dev or reset. Future migrations requiring additional DDL need explicit review.

## Controlled preparation and start

The launcher never starts/stops/removes/relabels or connects/disconnects external MySQL, even during error cleanup. Missing inputs or observed identity/network/route/privilege drift stop the operation. It does not initialize schemas or create persistent credentials.

1. Verify the loaded release and collect the private input from actual observations. Review schema/accounts, capacity and recovery readiness.
2. Run `prepare` with the private JSON and settings. It validates the external original identity and creates only missing owned, stopped resources without recreating existing containers.
3. The operator separately authorizes and makes the one external MySQL backend attachment, preserving original endpoints and default route. Its exact actual network ID/address/alias must match the launcher. No other application container joins the Oracle networks.
4. Run `migrate`; API/Web remain stopped, the shared server stays externally managed, and the migrator verifies its source identity before DDL.
5. Create or assign the controlled account through `account` and the existing hidden-input CLI. Creating a real account/password is an operator action; do not use demonstration credentials. Retain TOTP and administrator requirements.
6. Run `start`. This explicitly starts Redis, API, then Web. It never starts migration implicitly. Verify the local SSH browser path, login/TOTP and existing account isolation.

```sh
node scripts/ssh-shared-deploy.mjs prepare /absolute/private-input.json /absolute/private.env
node scripts/ssh-shared-deploy.mjs migrate /absolute/private-input.json /absolute/private.env
node scripts/ssh-shared-deploy.mjs account /absolute/private-input.json /absolute/private.env create
node scripts/ssh-shared-deploy.mjs start /absolute/private-input.json /absolute/private.env
node scripts/ssh-shared-deploy.mjs check /absolute/private-input.json /absolute/private.env
```

All operations share `/run/lock/star-oracle-shared.lock` for the full worker/pipeline lifetime. A competing operation fails; stale workers block ingress until safely resolved. Maintenance does not automatically restart API/Web. Every container uses restart `no`, so startup after a reboot goes through the same checks. Do not use generic `compose up`, merge Compose files, add services, edit port bindings, or bypass the launcher to work around a failed check.

Before an existing dataset changes deployment profiles, run the existing offline `revoke-all-sessions` operation so old sessions/challenges/trusted devices cannot survive merely because a cookie name changed. This retains accounts, roles, passwords, TOTP and encrypted business data. Consult `docs/ACCOUNTS.md` for hidden input and legacy account linking.

## Backup and candidate recovery

Shared export uses only the schema-scoped SELECT account, single-transaction tables-only mysqldump and no global locks/tablespaces/triggers/routines/events. SQL flows to gzip then age. Every temporary dump/import/account/candidate container uses Docker log driver `none`, so the daemon does not retain or forward the plaintext stream. Ciphertext appears atomically only after every pipeline stage succeeds; incomplete files are never published. Supply the public age recipient and output path to the shared backup command. Retain the private age identity separately and securely.


```sh
node scripts/ssh-shared-backup.mjs /absolute/private-input.json /absolute/private.env /absolute/backup.sql.gz.age age1PUBLIC_RECIPIENT
node scripts/ssh-shared-restore.mjs /absolute/private-input.json /absolute/private.env /absolute/backup.sql.gz.age /absolute/age-identity.txt /absolute/candidate.json /absolute/candidate.env
```

All paths are absolute. Native age identities are supported; SSH keys and identity plugins are refused. The compressed archive is limited to 256 MiB and decompressed SQL to 1 GiB. `TMPDIR` selects the private temporary filesystem.

Recovery authenticates the whole age archive, verifies gzip and completes bounded decompression into private temporary storage before any database connection, including identity probes. Use an encrypted filesystem or adequately sized tmpfs; unlinking plaintext is cleanup, not guaranteed secure erasure on SSD/COW storage.

The operator precreates a new empty `staroraclerestore<suffix>` schema and independent candidate-only importer/migrator/app credentials. A separate private candidate input and secret file are mandatory. They can never name the original schema or reuse its settings. The candidate JSON has exactly `format: 1`, `database` and `provisioningAudit`; its audit uses the same required flags and server UUID with the new candidate schema. The candidate secret file has exactly `IMPORTER_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`, and `REDIS_PASSWORD`, each an independent 64-character hexadecimal value, different from every original secret. Candidate users are `sor_i_<suffix>`, `sor_m_<suffix>`, and `sor_a_<suffix>` and connect only from `.7`; importer DROP is confined to that empty candidate for compatible historical dumps. No root, global CREATE/DROP, FILE, local-infile or client shell commands are allowed.

The candidate has a fresh Redis at `.8` with a new owned volume, never the main `.5` or another application's Redis. Recovery imports, deploys committed migrations, checks migration status and actual schema, revokes restored session/challenge/trusted-device material, and performs offline decryptability/ownership validation. Automated offline verification is not a substitute for operator business-flow validation. It does not expose a candidate Web/API endpoint, change traffic, overwrite the original schema or flush any production cache. Failed candidate volumes are retained for diagnosis and only owned candidate workers are stopped.

The same MySQL process services original and candidate schemas, so a contained restore can still affect availability or shared resources. Schedule maintenance, use bounded workers and connections, and stop on resource pressure. Cutover or deletion of an old schema is a separate reviewed operator action.
