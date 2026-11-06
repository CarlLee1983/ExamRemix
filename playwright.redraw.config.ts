import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser',testMatch:'redraw-fixture.spec.ts',workers:1,use:{baseURL:'http://127.0.0.1:4414'},webServer:{command:'node tests/fixtures/redraw-browser/server.ts',url:'http://127.0.0.1:4414/tests/fixtures/redraw-browser/',reuseExistingServer:false,timeout:30000}});
