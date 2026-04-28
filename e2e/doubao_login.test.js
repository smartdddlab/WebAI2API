/**
 * 豆包登录测试 - 用于手动登录并保存状态
 */
import { test, expect } from '@playwright/test';

test('豆包手动登录', async ({ page }) => {
    // 访问豆包
    await page.goto('https://www.doubao.com/chat');
    await page.waitForTimeout(5000);
    
    // 打印当前 URL
    console.log('Current URL:', page.url());
    
    // 等待手动登录 - 添加一个明显的标记
    const loginMarker = page.locator('text=请在此处登录');
    if (await loginMarker.count() > 0) {
        console.log('需要登录，请手动完成登录...');
    }
    
    // 等待 5 分钟让用户手动操作
    console.log('等待手动登录 (5分钟)...');
    await page.waitForTimeout(300000); // 5分钟
    
    // 验证登录成功
    const loginBtn = page.locator('button').filter({ hasText: '登录' });
    if (await loginBtn.count() === 0) {
        console.log('登录成功！');
    } else {
        console.log('仍未登录');
    }
});
