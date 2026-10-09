import {defineConfig,devices} from '@playwright/test';

// These tests route every API response and exercise real form/default actions.
// They never create database accounts or contact an external model provider.
export default defineConfig({
 testDir:'.',testMatch:['form-action-boundaries.spec.ts','review-retry-boundaries.spec.ts'],
 outputDir:'../../test-results/optimization',timeout:30000,workers:1,retries:0,
 use:{baseURL:'http://localhost:5173',trace:'retain-on-failure',serviceWorkers:'block'},
 projects:[
  {name:'optimization-desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},
  {name:'optimization-iphone-webkit',use:{...devices['iPhone 13']}},
  {name:'optimization-small-chromium',use:{...devices['Desktop Chrome'],viewport:{width:320,height:780}}},
 ],
 webServer:{cwd:process.cwd(),command:'npm run dev:web',url:'http://localhost:5173',reuseExistingServer:false},
 reporter:[['list'],['html',{outputFolder:'../../playwright-report/optimization',open:'never'}]],
});
