# Controlled username accounts

The owner requests pre-created username/password accounts instead of public email registration. This supersedes the prior requirement for SMTP/email verification; HTTPS, CSRF, SecureCookie, administrator TOTP and private-data boundaries remain required. No production account is created or modified in this implementation.

Use Better Auth 1.7.7's native username plugin and its existing TOTP hook. Add only nullable unique `User.username` (3–32 ASCII letters/digits/dot/underscore/hyphen, first character alphanumeric, trim/lowercase). Validate ASCII before case normalization. Existing users retain IDs, emails, verification state, passwords, role, TOTP and owned records; they have no username until an operator explicitly assigns one by user ID. Existing sessions without a provisioned username are rejected. No automatic identity guessing from emails.

Allow only the methods and authentication routes the application actually uses. Deny registration, email sign-in/verification/reset, username enumeration and online username/email/password changes server-side. Signup is also disabled in Better Auth configuration. Session creation and established-session operations reread live DB user/session state. Pending TOTP remains possible without a full session; it must not turn a stale cached session into an authenticated setup session.

Offline CLI supports create, assign-username and reset-password. Passwords enter only through hidden TTY input with repeated confirmation, never arguments, environment or stdin pipes. New users are ordinary accounts with random non-deliverable internal email and `emailVerified:false`; credential account hashes use the authentication library. Assignment preserves credentials and privileges. Reset preserves TOTP, and targets the user's database and Redis sessions, 2FA challenges and trusted-device artifacts. Stop/drain all API replicas before maintenance; restart only after successful cleanup. The CLI cannot prove the operator has stopped every replica and does not claim live-reset race safety.

Login retains the daylight visual design and masked secrets, presents username/password and contact-administrator recovery guidance. Obsolete email token URLs are scrubbed and cannot reactivate email flows. TOTP QR labels use the public username, preserving the actual secret and issuer query.

Independent design review checked installed username/two-factor/Redis adapter source. Reference: https://better-auth.com/docs/plugins/username . No framework migration or new authentication engine.
