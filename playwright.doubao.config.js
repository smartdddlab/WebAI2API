import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 600000, // 10分钟超时用于手动登录
    retries: 0,
    workers: 1,
    use: {
        headless: false,
        viewport: { width: 1280, height: 800 },
        // 使用 camoufox 的用户数据目录（包含 cookies）
        storageState: undefined, // 不加载状态，让用户手动登录
    },
    projects: [
        {
            name: 'doubao_login',
            use: { 
                browserName: 'chromium',
            },
            testMatch: 'doubao_login.test.js',
        },
    ],
});
