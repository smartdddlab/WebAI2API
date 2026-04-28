import { chromium } from 'playwright-core';

const context = await chromium.launchPersistentContext('./data/camoufoxUserData', { 
    headless: false
});

const page = context.pages()[0] || await context.newPage();

await page.goto('https://www.doubao.com/chat');
await page.waitForTimeout(2000);

// 保存登录状态
await context.storageState({ path: './data/doubao-auth.json' });
console.log('登录状态已保存到 ./data/doubao-auth.json');
console.log('文件大小:', (await import('fs')).statSync('./data/doubao-auth.json').size, 'bytes');

await context.close();
