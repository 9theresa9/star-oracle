import {defineConfig,devices} from '@playwright/test';

const origin='http://localhost:17777';

// The runner uses the existing isolated test fixtures; only the API process uses
// the formal production profile. Redis must require authentication in that mode.
export default defineConfig({
 testDir:'.',testMatch:['ssh-only.spec.ts','session-boundary.spec.ts'],
 outputDir:'../../test-results/ssh-only',timeout:60000,workers:1,
 maxFailures:process.env.CI?10:0,
 use:{baseURL:origin,trace:'retain-on-failure'},
 projects:[
  {name:'ssh-desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},
  {name:'ssh-iphone-webkit',use:{...devices['iPhone 13']}},
  {name:'ssh-small-chromium',use:{...devices['Desktop Chrome'],viewport:{width:320,height:780}}},
 ],
 webServer:[
  // Raw TCP readiness: a direct health URL has the wrong Host. The first real
  // session test checks health through the Vite entry with localhost:17777.
  {cwd:process.cwd(),command:'node apps/api/dist/main.js',port:3112,reuseExistingServer:false,
   env:{PORT:'3112',NODE_ENV:'production',DEPLOYMENT_MODE:'ssh-only',SSH_ONLY_CONTAINER:'false',WEB_ORIGIN:origin,API_PUBLIC_URL:origin,ADMIN_REQUIRE_2FA:'true',TRUST_PROXY:'false'}},
  {cwd:process.cwd(),command:'npm run dev -w @star-oracle/web -- --port 17777 --strictPort',url:origin,reuseExistingServer:false,
   env:{API_DEV_TARGET:'http://127.0.0.1:3112',VITE_API_ORIGIN:origin}},
 ],
 reporter:[['list'],['html',{outputFolder:'../../playwright-report/ssh-only',open:'never'}]],
});
