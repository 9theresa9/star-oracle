# Persistent SSH-only deployment

The owner explicitly chose a permanent SSH-only HTTP deployment with ordinary accounts and data, without a domain or installing a certificate authority. This is a separate, default-off deployment mode. It is not a test system and does not weaken the default public HTTPS mode.

## Boundary

The browser opens exactly `http://localhost:17777`. An explicitly loopback-bound SSH local forward carries traffic to server loopback port 17777. SSH protects that middle transport. HTTP and localhost cookies do not protect against malicious software on either endpoint; cookies are not isolated by port. A privileged operator can expose any service using an additional proxy, so the launcher does not promise protection against a hostile root operator.

`DEPLOYMENT_MODE=ssh-only` requires the production runtime, exact literal origins, administrator 2FA, authenticated dedicated Redis and production-quality secrets. It forbids proxy trust. Native API listens only on 127.0.0.1. Docker API has no published ports and accepts only the dedicated web peer; its own loopback is restricted to health probes. Raw Host, actual socket peer and forwarding headers are checked independently of Origin/CSRF. Existing password/TOTP, precreated-account allowlists, quotas, session/actor generations and private data checks remain in effect.

SSH cookies use the complete `star-oracle-ssh` family, host-only, HttpOnly, SameSite=Lax, Path=/, without Secure or a Secure prefix. Public production retains HTTPS, Secure cookies and its existing names. HSTS is omitted only in SSH mode. A cookie rename is not cryptographic revocation: switching an existing database between transport modes requires the offline revoke-all-sessions operation, preserving password hashes, TOTP material, roles and encryption keys.

## Deployment

A dedicated Compose file is never merged with the public 80/443 configuration. Only the web service publishes 127.0.0.1:17777. The launcher uses a fixed local Docker context/project, accepts a checksum-verified release manifest, validates rendered Compose configuration, creates stopped containers, inspects actual bindings/network options, then starts and rechecks. Docker 28+ is required. Web ingress also filters actual source peers to prevent Docker direct-routing from turning a private container address into an alternative entrance. Network option, IPv6, privilege, host networking, extra endpoint and port mismatches fail closed. Diagnostics never dump configurations containing credentials.

Dedicated Star Oracle MySQL database/accounts and Redis remain mandatory. The reference stack owns its own MySQL volume; shared-MySQL deployment requires a separately reviewed server-specific topology. No real credentials, accounts, networks or server permissions are created by this code change.

## Verification and delivery

Unit and HTTP tests cover strict configuration/header parsing, default HTTPS regression and failed isolation checks. CI runs the real native SSH profile in Chromium/WebKit, password and TOTP flows, refresh/logout, old cookie profiles and cross-tab A-B-A identity changes. Real Docker checks validate publication and direct-network rejection. After successful complete verification, CI exports the exact tested API/web and required runtime images with source SHA, architecture, image IDs and checksums; no registry publishing or server build is required. Only synthetic credentials appear in CI. Production deployment remains a separate action.
