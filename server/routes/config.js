import { Router } from 'express';
import {
  clearWeiboCookie,
  getConfigStatus,
  saveWeiboCookie
} from '../services/configService.js';

const router = Router();

router.get('/status', (req, res) => {
  try {
    res.json(getConfigStatus());
  } catch (error) {
    res.status(500).json({
      hasCookie: false,
      maskedCookie: '',
      error: error?.message || '读取 Cookie 配置失败'
    });
  }
});

router.post('/cookie', (req, res) => {
  try {
    res.json(saveWeiboCookie(req.body?.cookie));
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error?.message || 'Cookie 保存失败'
    });
  }
});

router.delete('/cookie', (req, res) => {
  try {
    res.json(clearWeiboCookie());
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Cookie 清空失败'
    });
  }
});

export default router;
