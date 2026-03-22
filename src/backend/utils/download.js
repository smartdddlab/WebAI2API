/**
 * @fileoverview 资源下载模块
 * @description 图片下载与 Base64 转换
 */

/**
 * 使用页面上下文下载图片并转换为 Base64
 * 自动继承页面的 Cookie 和 Session，解决鉴权问题
 * @param {string} url - 图片 URL
 * @param {import('playwright-core').Page} page - Playwright 页面对象
 * @param {object} [options] - 可选配置
 * @param {number} [options.timeout=60000] - 超时时间（毫秒）
 * @param {number} [options.retries=0] - 下载失败时的重试次数
 * @returns {Promise<{ image?: string, error?: string }>} 下载结果
 */
export async function useContextDownload(url, page, options = {}) {
    const { timeout = 60000, retries = 0 } = options;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await page.request.get(url, { timeout });

            if (!response.ok()) {
                if (attempt < retries) continue;
                return { error: `下载失败: HTTP ${response.status()}` };
            }

            const buffer = await response.body();
            const base64 = buffer.toString('base64');
            const contentType = response.headers()['content-type'] || 'image/png';
            const mimeType = contentType.split(';')[0].trim();

            return { image: `data:${mimeType};base64,${base64}` };
        } catch (e) {
            if (attempt < retries) continue;
            return { error: `已获取结果，但图片下载时遇到错误: ${e.message}` };
        }
    }
}
