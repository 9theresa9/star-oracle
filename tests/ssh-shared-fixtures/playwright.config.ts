import {defineConfig,devices} from '@playwright/test';

if(process.env.CI!=='true')throw new Error('Shared browser verification is restricted to isolated CI.');
// Playwright otherwise records a DOM snapshot on failure even with tracing off;
// the enrollment screen can contain authenticator and recovery secrets.
process.env.PLAYWRIGHT_NO_COPY_PROMPT='1';

export default defineConfig({
 testDir:'.',
 testMatch:'shared-browser.spec.ts',
 outputDir:'../../test-results/ssh-shared',
 timeout:180000,
 expect:{timeout:15000},
 workers:1,
 fullyParallel:false,
 retries:0,
 forbidOnly:true,
 // Each scenario consumes its own preprovisioned TOTP account. Retrying with the
 // same account would not reproduce the original enrollment state.
 use:{
  baseURL:'http://localhost:17777',
  serviceWorkers:'block',
  actionTimeout:15000,
  navigationTimeout:30000,
  // Authentication material must never be included in browser artifacts.
  trace:'off',screenshot:'off',video:'off',
 },
 projects:[
  {name:'shared-desktop-chromium',metadata:{accountOffset:0},use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},
  {name:'shared-iphone-webkit',metadata:{accountOffset:2},use:{...devices['iPhone 13']}},
  {name:'shared-small-chromium',metadata:{accountOffset:4},use:{...devices['Desktop Chrome'],viewport:{width:320,height:780}}},
 ],
 // The caller starts the already-built API/Web images and supplies readiness.
 // No dev server, account provisioner or loopback database fixture runs here.
 reporter:[['list']],
});
