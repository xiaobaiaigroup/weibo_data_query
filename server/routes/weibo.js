import { Router } from 'express';
import { batchFetchWeiboInfo } from '../services/weiboService.js';

const router = Router();
const MAX_BATCH_URLS = 50;

router.post('/batch', async (req, res) => {
  const urls = req.body?.urls;

  if (!Array.isArray(urls)) {
    res.status(400).json({ error: '请求参数 urls 必须是数组' });
    return;
  }

  const cleanUrls = urls
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  if (cleanUrls.length === 0) {
    res.status(400).json({ error: '请输入至少一条微博链接' });
    return;
  }

  if (cleanUrls.length > MAX_BATCH_URLS) {
    res.status(400).json({
      success: false,
      message: '单次最多查询 50 条，请分批处理'
    });
    return;
  }

  try {
    const data = await batchFetchWeiboInfo(cleanUrls);
    const success = data.filter((item) => item.success).length;
    const failed = data.length - success;

    res.json({
      total: data.length,
      success,
      failed,
      data
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message || '批量查询失败'
    });
  }
});

export default router;
