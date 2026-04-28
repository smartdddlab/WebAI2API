/**
 * 豆包视频适配器 E2E 测试
 * @description 测试豆包视频生成页面：模型选择、视频生成、SSE 解析
 * @note 视频生成可能需要很长时间（AI排队），测试设计考虑了轮询等待机制
 */

import { test, expect } from '@playwright/test';

// --- 配置 ---
const TARGET_URL = 'https://www.doubao.com/chat/create-video';
const CAMOUFOX_PROFILE = '/home/lihejia/code/ai/WebAI2API/data/camoufoxUserData';

// --- 辅助函数 ---

/**
 * 解析 SSE 响应，提取视频链接
 * @param {string} body - SSE 响应体
 * @returns {{videoUrl: string|null, contentType: number|null, status: string|null}}
 */
function parseSSEForVideo(body) {
    let videoUrl = null;
    let contentType = null;
    let status = null;

    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const dataStr = trimmed.substring(5).trim();
        if (!dataStr || dataStr === '{}') continue;

        try {
            const data = JSON.parse(dataStr);

            // event_data 嵌套结构
            if (data.event_data) {
                const eventData = typeof data.event_data === 'string'
                    ? JSON.parse(data.event_data) : data.event_data;
                const message = eventData?.message;

                if (message?.content_type && message.content) {
                    contentType = message.content_type;
                    if (contentType >= 2080) {
                        const content = typeof message.content === 'string'
                            ? JSON.parse(message.content) : message.content;
                        const url = extractRawVideo(content);
                        if (url) videoUrl = url;
                    }
                }

                if (eventData.status) {
                    status = eventData.status;
                }
                continue;
            }

            if (data.status) {
                status = data.status;
            }

            const url = extractRawVideo(data);
            if (url) videoUrl = url;
        } catch { /* 忽略解析错误 */ }
    }

    return { videoUrl, contentType, status };
}

/**
 * 从 SSE 消息数据中提取视频链接
 * @param {Object} sseData
 * @returns {string|null}
 */
function extractRawVideo(sseData) {
    if (!sseData) return null;

    if (Array.isArray(sseData.patch_op)) {
        for (const op of sseData.patch_op) {
            const contentBlocks = op.patch_value?.content_block;
            if (Array.isArray(contentBlocks)) {
                for (const block of contentBlocks) {
                    if (block.block_type >= 2080) {
                        const url = extractRawVideo(block.content?.creation_block);
                        if (url) return url;
                    }
                }
            }
        }
    }

    if (Array.isArray(sseData.creations)) {
        for (const creation of sseData.creations) {
            const rawUrl = creation.video?.video_ori_raw?.url;
            if (rawUrl) return rawUrl;
        }
    }

    return null;
}

// --- Manifest 结构测试 ---

test.describe('Manifest 结构验证', () => {
    test('manifest 包含必要字段', async () => {
        const { manifest } = await import('../src/backend/adapter/doubao_video.js');

        expect(manifest.id).toBe('doubao_video');
        expect(manifest.displayName).toBeTruthy();
        expect(manifest.description).toBeTruthy();
        expect(typeof manifest.generate).toBe('function');
        expect(Array.isArray(manifest.models)).toBe(true);
        expect(manifest.models.length).toBeGreaterThan(0);
    });

    test('所有模型包含必要属性', async () => {
        const { manifest } = await import('../src/backend/adapter/doubao_video.js');

        for (const model of manifest.models) {
            expect(model.id).toBeTruthy();
            expect(model.codeName).toBeTruthy();
            expect(['optional', 'required', 'forbidden']).toContain(model.imagePolicy);
        }
    });

    test('getTargetUrl 返回正确 URL', async () => {
        const { manifest } = await import('../src/backend/adapter/doubao_video.js');
        expect(manifest.getTargetUrl()).toBe('https://www.doubao.com/chat/create-video');
    });
});

// --- SSE 解析函数单元测试 ---

test.describe('SSE 解析函数', () => {
    test('parseSSEForVideo 从 patch_op 结构提取视频 URL', () => {
        const mockSSE = `data: {"patch_op":[{"patch_value":{"content_block":[{"block_type":2080,"content":{"creation_block":{"creations":[{"video":{"video_ori_raw":{"url":"https://example.com/video1.mp4"}}}]}}}]}}]}`;
        const { videoUrl } = parseSSEForVideo(mockSSE);
        expect(videoUrl).toBe('https://example.com/video1.mp4');
    });

    test('parseSSEForVideo 从 creations 数组提取视频 URL', () => {
        const mockSSE = `data: {"creations":[{"video":{"video_ori_raw":{"url":"https://example.com/video2.mp4"}}}]}`;
        const { videoUrl } = parseSSEForVideo(mockSSE);
        expect(videoUrl).toBe('https://example.com/video2.mp4');
    });

    test('parseSSEForVideo 解析状态字段', () => {
        // 构造正确的双重 JSON 结构
        const sseData = { event_data: JSON.stringify({ status: "PROCESSING" }) };
        const mockSSE = `data: ${JSON.stringify(sseData)}`;
        const { status } = parseSSEForVideo(mockSSE);
        expect(status).toBe('PROCESSING');
    });

    test('parseSSEForVideo 过滤非视频类型 content_type', () => {
        const sseData = { event_data: JSON.stringify({ message: { content_type: 2074 } }) };
        const mockSSE = `data: ${JSON.stringify(sseData)}`;
        const { videoUrl } = parseSSEForVideo(mockSSE);
        expect(videoUrl).toBeNull();
    });

    test('parseSSEForVideo 处理空响应返回 null', () => {
        const { videoUrl } = parseSSEForVideo('data: {}');
        expect(videoUrl).toBeNull();
    });

    test('extractRawVideo 从 creations 数组提取视频 URL', () => {
        const sseData = {
            creations: [{
                video: {
                    video_ori_raw: {
                        url: 'https://example.com/test.mp4'
                    }
                }
            }]
        };
        const url = extractRawVideo(sseData);
        expect(url).toBe('https://example.com/test.mp4');
    });

    test('extractRawVideo 处理缺失 video 字段返回 null', () => {
        const sseData = {
            creations: [{
                image: {
                    image_ori_raw: {
                        url: 'https://example.com/image.png'
                    }
                }
            }]
        };
        const url = extractRawVideo(sseData);
        expect(url).toBeNull();
    });
});

// --- 页面交互 E2E 测试 ---
// 注意: 这些测试需要登录状态，如果未登录会失败
// 已跳过，实际需要时手动运行

test.describe.skip('豆包视频页面交互', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForTimeout(3000);
    });

    test('页面加载后显示 Seedance 模型选择器', async ({ page }) => {
        const modelBtn = page.getByRole('button', { name: 'Seedance 2.0 Fast' }).first();
        await expect(modelBtn).toBeVisible({ timeout: 20000 });
    });

    test('页面加载后显示视频输入框', async ({ page }) => {
        const input = page.locator('textbox').filter({ hasText: /描述你想要的视频/ }).first();
        if (await input.count() === 0) {
            const genericInput = page.locator('textarea, textbox').first();
            await expect(genericInput).toBeVisible({ timeout: 5000 });
        } else {
            await expect(input).toBeVisible({ timeout: 5000 });
        }
    });

    test('页面加载后显示比例按钮', async ({ page }) => {
        const ratioBtn = page.getByRole('button', { name: '比例' }).first();
        await expect(ratioBtn).toBeVisible({ timeout: 10000 });
    });
});

// --- 视频生成流程测试 ---
// 已跳过，实际需要时手动运行

test.describe.skip('视频生成流程', () => {
    test('发送提示词后能收到 SSE 响应 (5分钟超时)', async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForTimeout(2000);

        const input = page.locator('textbox').filter({ hasText: /描述你想要的视频/ });
        await input.waitFor({ state: 'visible', timeout: 15000 });

        await input.fill('一只猫在草地上奔跑');

        const ssePromise = page.waitForResponse(
            resp => resp.url().includes('chat/completion') &&
                   resp.headers()['content-type']?.includes('text/event-stream'),
            { timeout: 300000 }
        );

        await page.keyboard.press('Enter');

        const response = await ssePromise;
        expect(response.status()).toBe(200);

        const body = await response.text();
        const { contentType, status } = parseSSEForVideo(body);

        console.log(`[视频生成] content_type: ${contentType}, status: ${status}`);

        expect(body.length).toBeGreaterThan(0);
    });

    test('SSE 响应解析能正确识别 content_type', async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForTimeout(2000);

        const input = page.locator('textbox').filter({ hasText: /描述你想要的视频/ });
        await input.waitFor({ state: 'visible', timeout: 15000 });

        await input.fill('测试视频生成');

        const ssePromise = page.waitForResponse(
            resp => resp.url().includes('chat/completion') &&
                   resp.headers()['content-type']?.includes('text/event-stream'),
            { timeout: 300000 }
        );

        await page.keyboard.press('Enter');

        const response = await ssePromise;
        const body = await response.text();
        const { contentType } = parseSSEForVideo(body);

        console.log(`[content_type] 值为: ${contentType}`);

        if (contentType !== null) {
            expect(typeof contentType).toBe('number');
        }
    });

    test('页面在视频生成期间保持响应', async ({ page }) => {
        await page.goto(TARGET_URL);
        await page.waitForTimeout(2000);

        const input = page.locator('textbox').filter({ hasText: /描述你想要的视频/ });
        await input.waitFor({ state: 'visible', timeout: 15000 });

        await input.fill('测试视频生成');
        await page.keyboard.press('Enter');

        await page.waitForTimeout(5000);

        const title = await page.title();
        expect(title).toContain('豆包');

        const modelBtn = page.getByRole('button', { name: 'Seedance 2.0 Fast' });
        await expect(modelBtn).toBeVisible({ timeout: 5000 });
    });
});

// --- 长时间轮询测试 (需要时手动运行) ---

test.describe.skip('长时间视频生成测试', () => {
    test('完整视频生成流程 (需要手动触发)', async ({ page }) => {
        // 这个测试标记为 slow，需要手动运行
        // npx playwright test e2e/doubao_video.test.js --grep "完整视频生成"
        test.slow();

        await page.goto(TARGET_URL);
        await page.waitForTimeout(2000);

        const input = page.locator('textbox').filter({ hasText: /描述你想要的视频/ });
        await input.waitFor({ state: 'visible', timeout: 15000 });

        await input.fill('一只小猫在草地上玩耍');

        // 开始监听
        const ssePromise = page.waitForResponse(
            resp => resp.url().includes('chat/completion') &&
                   resp.headers()['content-type']?.includes('text/event-stream'),
            { timeout: 300000 }
        );

        await page.keyboard.press('Enter');

        const response = await ssePromise;
        const body = await response.text();
        const { videoUrl, contentType, status } = parseSSEForVideo(body);

        console.log(`[结果] content_type: ${contentType}, status: ${status}, videoUrl: ${videoUrl ? '已获取' : '未获取'}`);

        // 如果直接获取到 URL，测试成功
        if (videoUrl) {
            expect(videoUrl).toContain('http');
            return;
        }

        // 否则验证状态更新
        if (status) {
            console.log(`[状态] ${status}`);
        }

        // 页面应该仍然可交互
        const modelBtn = page.getByRole('button', { name: 'Seedance 2.0 Fast' });
        await expect(modelBtn).toBeVisible({ timeout: 5000 });
    });
});
