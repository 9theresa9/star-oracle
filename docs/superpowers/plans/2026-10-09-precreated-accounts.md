# Controlled Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Provide controlled offline-created username/password access without any public registration or email dependency.
**Architecture:** Retain Better Auth and add its username plugin, a nullable username migration and a deny-by-default HTTP endpoint policy. Offline maintenance is a separate compiled CLI and transaction service.
**Tech Stack:** React 19, Vite, NestJS 11, Prisma 6, MySQL 8.4, Redis 7.4, Better Auth 1.7.7.
**Spec:** ../specs/2026-10-09-precreated-accounts-design.md

## Global constraints
- No real accounts/keys, deployment, merging, unrelated changes or destructive migration.
- Preserve HTTPS, SecureCookie, CSRF, administrator TOTP and all existing session/privacy/AI/backup safeguards.
- Synthetic isolated fixtures only; no live email or model requests.

## Review focus
- Unicode/case aliases and concurrent duplicate username inserts.
- Cached session and pending TOTP/trusted-device access after offline reset.
- Legacy hash/role/TOTP/record preservation and no automatic email mapping.
- Hidden input cleanup/cancel/mismatched passwords and secret-free errors.
- Server-side alternate auth routes and direct requests bypassing UI.

## Tasks
1. Write production no-SMTP and closed-route tests; observe failure. Add username schema/plugin, HTTP allowlist, live-user session hooks; run focused tests and typecheck.
2. Write account-service and terminal tests; observe failure. Add transaction-safe provision/assignment/reset and hidden-prompt CLI; test real isolated MySQL/Redis and failure paths.
3. Replace email UI with username login and administrator-help copy. Adapt synthetic fixture setup and browser flow assertions, preserving all business/TOTP/session coverage.
4. Update Compose/env/docs/admin maintenance, remove obsolete SMTP dependencies and CI mail fixture. Run migrations/schema diff/full unit/API/build/security checks.
5. Independently review patch, scan publication set for secrets, update PR5, verify exact SHA CI including three browser projects and Docker recovery. Inspect completed screenshots, preserve evidence, close only this task's local services.
