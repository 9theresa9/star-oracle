# Vue migration module

This independent Vue3/TypeScript/Vite module contains the original complete tutorial page:10courses/40steps, category filtering, local-only progress and host-provided actor scoping. `src/tutorials/TutorialPage.vue` accepts the confirmed actor ID; the isolated public entry intentionally uses the existing guest namespace. It implements no login and performs no API requests. The existing React application and deployment entry are preserved until the remaining pages and real session/API integration are migrated.

Node24:

```
npm ci --ignore-scripts
npm run check
npm run dev
```

The review entry is `/vue/`. Existing exploration/library destinations continue to point to the original application. The module uses canonical packages/domain tutorials and existing app CSS, not copied demo content. `check` runs Vue composable/SFC SSR tests, strict type checking and a real production build; it is not whole-project acceptance.

Before switching any production host, run the real-browser gate with the existing root Playwright dependency/browser installed:

```
node tests/tutorialBrowser.mjs
```

Optional test-only environment variables select an existing Playwright module/browser executable or screenshot path: ORACLE_TEST_PLAYWRIGHT_MODULE, ORACLE_TEST_BROWSER_EXE and ORACLE_TEST_SCREENSHOT. The gate starts and stops only its own loopback Vite process, uses a fresh isolated browser context and blocks external network requests. Local execution currently fails at sandbox loopback EACCES before launching the browser; this is not skipped or represented as a browser pass. Authenticated host integration and all API-backed Vue pages remain pending.
