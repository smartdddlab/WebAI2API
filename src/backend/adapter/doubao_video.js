/**
 * @fileoverview 豆包 (Doubao) 视频生成适配器
 *
 * 流程:
 *   1. 导航到 /chat/create-video（Seedance 模型已预选）
 *   2. 在 contenteditable 输入框中填入提示词
 *   3. 按 Enter 发送，URL 变为 /chat/{conversation_id}
 *   4. SSE 返回文本回复（不含视频 URL），约 120 秒后页面显示"生成好啦"
 *   5. 点击 xgplayer 视频播放器容器触发初始化，从 <video> src 提取视频 URL
 *   6. 通过浏览器上下文下载视频
 */

import {
    sleep,
    humanType,
    safeClick
} from '../engine/utils.js';
import {
    normalizePageError,
    waitForInput,
    gotoWithCheck,
    useContextDownload
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

const TARGET_URL = 'https://www.doubao.com/chat/create-video';

const POLL_INTERVAL = 5000;
const MAX_WAIT_MS = 600000;       // 10 分钟
const VIDEO_INIT_TIMEOUT = 30000; // 视频播放器初始化等待

async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;

    try {
        logger.info('适配器', '导航到豆包视频生成页面...', meta);
        await gotoWithCheck(page, TARGET_URL);
        await sleep(2000, 3000);

        // 1. 等待视频输入框出现
        const inputLocator = page.locator('[contenteditable="true"]').first();
        logger.debug('适配器', `等待输入框... count: ${await inputLocator.count()}`, meta);
        await waitForInput(page, inputLocator, { click: true });

        // 2. 填写提示词
        await safeClick(page, inputLocator, { bias: 'input' });
        await humanType(page, inputLocator, prompt);

        // 3. 发送请求
        logger.info('适配器', '发送视频生成请求...', meta);
        await page.keyboard.press('Enter');
        logger.info('适配器', 'Enter 已按下，开始等待视频生成完成', meta);

        // 4. 等待视频生成完成
        const { videoUrl, error } = await waitForVideoCompletion(page, meta);
        logger.info('适配器', `waitForVideoCompletion 返回: videoUrl=${!!videoUrl}, error=${error}`, meta);

        if (error) {
            return { error };
        }

        if (!videoUrl) {
            return { error: '视频生成超时或未能提取视频链接' };
        }

        logger.info('适配器', `视频链接: ${videoUrl.substring(0, 100)}...`, meta);

        // 5. 下载视频
        const downloadResult = await useContextDownload(videoUrl, page, {
            retries: config?.backend?.pool?.failover?.imgDlRetry ? 2 : 0,
            timeout: 300000
        });

        if (downloadResult.error) {
            return downloadResult;
        }

        return { image: downloadResult.image, imageUrl: videoUrl };

    } catch (err) {
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    }
}

/**
 * 轮询等待视频生成完成，然后提取视频 URL
 * 使用 Playwright getByText 搜索全文，避免 innerText 截断问题
 */
async function waitForVideoCompletion(page, meta) {
    const startTime = Date.now();
    logger.info('适配器', '进入 waitForVideoCompletion 轮询循环', meta);

    let lastLogTime = 0;
    while ((Date.now() - startTime) < MAX_WAIT_MS) {
        await sleep(POLL_INTERVAL);
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        try {
            // 先滚动到底部，确保最新消息已渲染
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

            // 用 Playwright getByText 搜索全文，不受 innerText 长度限制
            const completeMsg = page.getByText('生成好啦').first();
            const failMsg = page.getByText('生成失败').first();
            const quotaMsg = page.getByText(/额度不足|额度已用完|达到上限|生成次数/).first();

            // 每 60 秒输出一次调试信息
            if (elapsed - lastLogTime >= 60) {
                lastLogTime = elapsed;
                const pageUrl = page.url();
                const bodySample = await page.evaluate(() => {
                    const t = document.body?.innerText || '';
                    return t.substring(t.length - 500); // 尾部 500 字符
                });
                logger.info('适配器', `[${elapsed}s] 轮询中 | URL: ${pageUrl.substring(0, 80)} | 页面尾部: ...${bodySample.substring(bodySample.length - 200)}`, meta);
            }

            if (await quotaMsg.count() > 0) {
                return { videoUrl: null, error: '视频生成额度不足或已用完' };
            }
            if (await failMsg.count() > 0) {
                logger.warn('适配器', `[${elapsed}s] 生成失败`, meta);
                return { videoUrl: null, error: '视频生成失败' };
            }

            if (await completeMsg.count() > 0) {
                logger.info('适配器', `[${elapsed}s] 检测到视频生成完成`, meta);

                const videoUrl = await extractVideoUrl(page, meta);
                if (videoUrl) return { videoUrl, error: null };

                logger.info('适配器', '视频播放器尚未初始化，继续等待...', meta);
            }

        } catch (e) {
            logger.warn('适配器', `[${elapsed}s] 轮询异常: ${e.message}`, meta);
        }
    }

    logger.warn('适配器', '等待视频生成超时', meta);
    return { videoUrl: null, error: null };
}

/**
 * 从页面提取视频 URL
 * 优先等待 video 元素自动出现，超时后点击播放器容器触发 xgplayer 初始化
 */
async function extractVideoUrl(page, meta) {
    // 阶段 1: 等待 video 元素自动出现（带 src）
    const deadline = Date.now() + VIDEO_INIT_TIMEOUT;

    while (Date.now() < deadline) {
        const src = await page.evaluate(() => {
            const v = document.querySelector('video[src]');
            return v ? v.src : null;
        });

        if (src) {
            logger.info('适配器', '从自动初始化的 video 元素获取到 URL', meta);
            return src;
        }

        // 每 2 秒检查一次
        await sleep(2000, 3000);
    }

    // 阶段 2: 点击播放器容器触发 xgplayer 初始化
    logger.info('适配器', '点击视频播放器触发初始化...', meta);

    const playerBox = await page.locator('[class*="video-player"]').first().boundingBox();
    if (playerBox) {
        await page.mouse.click(
            playerBox.x + playerBox.width / 2,
            playerBox.y + playerBox.height / 2
        );
        await sleep(2000, 3000);

        // 等待 xgplayer 初始化完成（data-xgplayerid 出现）
        try {
            await page.waitForSelector('video[src]', { timeout: 15000 });
            const src = await page.locator('video').first().getAttribute('src');
            if (src) {
                logger.info('适配器', '从点击触发的 xgplayer 获取到 URL', meta);
                return src;
            }
        } catch {
            logger.debug('适配器', '点击后未检测到 video[src]', meta);
        }
    }

    // 阶段 3: 兜底 - 尝试从任意 video 或 source 元素获取
    const fallbackSrc = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (v?.src) return v.src;
        if (v?.currentSrc) return v.currentSrc;
        const s = document.querySelector('source[src]');
        if (s?.src) return s.src;
        return null;
    });

    if (fallbackSrc) {
        logger.info('适配器', '兜底提取到视频 URL', meta);
        return fallbackSrc;
    }

    return null;
}

export const manifest = {
    id: 'doubao_video',
    displayName: '豆包 (视频生成)',
    description: '使用字节跳动豆包生成视频，支持 Seedance 2.0 Fast 模型。需要已登录的豆包账户。',

    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    models: [
        { id: 'seedance-2.0-fast', codeName: 'Seedance 2.0 Fast', imagePolicy: 'optional', type: 'video' }
    ],

    navigationHandlers: [],

    generate
};
