# Vue migration review module

From this directory on Node24, run `npm ci --ignore-scripts` and `npm run dev`. Public review pages: `/vue/tutorials` and `/vue/library` on the printed loopback address. `npm run check` runs actual Vue unit/SSR tests, type checking and production build.

The tutorial keeps original guest/account-keyed local progress; this isolated host supplies guest until verified-session integration is complete. Library content/art/search/details use the canonical original domain data. These public features originally require no backend API. Other/authenticated journeys and the default production entry are not switched to Vue yet. Original React app stays available.

Actual browser scripts `tests/tutorialBrowser.mjs` and `tests/libraryBrowser.mjs` accept `ORACLE_TEST_PLAYWRIGHT_MODULE` (otherwise installed `@playwright/test`) and optional `ORACLE_TEST_BROWSER_EXE`. They own/close Vite127.0.0.1:5177 and a fresh browser context, block external requests, and fail on missing browser/runtime, permission/connection, console/page errors or assertions. They are separate from the unit/SSR CI job; real Java integration must still be added for API-backed features. See `../docs/migration/2026-10-19-vue-library-verification.md` for actual results and remaining work.
