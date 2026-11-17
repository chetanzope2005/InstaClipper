import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

import { cookiePool, getInstagramVideo, getInstagramAudio } from './services/instagramService.js';
import { getYoutubeVideo, getYoutubeAudio } from './services/youtubeService.js';
import { getFacebookVideo, getFacebookAudio } from './services/facebookService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '32kb';
// Keep disabled unless the product has explicit platform authorization for downloads.
const YOUTUBE_ENABLED = false;

// Enable Reverse Proxy Trust (Required for Render, Vercel, Cloudflare, Nginx)
app.set('trust proxy', 1);

app.use(compression());

// Security Response Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: MAX_BODY_SIZE }));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  setHeaders(res, filePath) {
    if (path.extname(filePath).toLowerCase() === '.html') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

function sendDownloadError(req, res, status, message) {
  if (req.query.downloadTarget === 'frame') {
    const payload = JSON.stringify({ type: 'download-error', message }).replace(/</g, '\\u003c');
    return res.status(status).type('html').send(
      `<!doctype html><meta charset="utf-8"><script>parent.postMessage(${payload}, location.origin);</script>`
    );
  }
  return res.status(status).type('text/plain').send(message);
}

function handleRateLimit(req, res, next, options) {
  const message = typeof options.message === 'string'
    ? options.message
    : options.message?.error || 'Too many requests. Please try again later.';

  if (req.query.downloadTarget === 'frame') {
    return sendDownloadError(req, res, options.statusCode, message);
  }
  return res.status(options.statusCode).json({ error: message });
}

/* ==========================================================================
   RATE LIMITERS (Abuse & Bot Spam Protection)
   ========================================================================== */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' },
  handler: handleRateLimit
});

const heavyApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please wait 1 minute before making another request.' },
  handler: handleRateLimit
});

app.use('/api/', generalLimiter);

/**
 * FIX 3: SSRF PROTECTION: Domain & IP Whitelist Validator
 * Allows verified CDNs for Instagram, Meta/Facebook, and YouTube/Google.
 */
function isAllowedCdnDomain(targetUrl) {
  try {
    const parsed = new URL(targetUrl);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block private/loopback/cloud metadata IP addresses
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.startsWith('169.254.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return false;
    }

    const allowedDomains = [
      'cdninstagram.com',
      'instagram.com',
      'fbcdn.net',
      'facebook.com',
      'googlevideo.com',
      'youtube.com',
      'ytimg.com',
      'youtu.be'
    ];

    return allowedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch (err) {
    return false;
  }
}

function isYoutubeMediaUrl(targetUrl) {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return ['youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com']
      .some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * FIX 3: Safe Stream Fetcher with Step-by-Step Redirect Validation
 * Prevents open-redirect SSRF into internal networks / cloud metadata
 */
async function safeFetchStream(initialUrl, maxHops = 5) {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= maxHops; hop++) {
    if (!isAllowedCdnDomain(currentUrl)) {
      throw new Error('Media source redirected to an unsupported address.');
    }
    if (!YOUTUBE_ENABLED && isYoutubeMediaUrl(currentUrl)) {
      throw new Error('YouTube downloads are not available yet.');
    }

    const response = await axios.get(currentUrl, {
      responseType: 'stream',
      maxRedirects: 0,
      timeout: 20000,
      validateStatus: s => (s >= 200 && s < 400),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    });

    // Check for HTTP redirect (301, 302, 303, 307, 308)
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      const redirectTarget = new URL(response.headers.location, currentUrl).href;
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
      currentUrl = redirectTarget;
      continue;
    }

    if (response.status >= 300 && response.status < 400) {
      response.data?.destroy?.();
      throw new Error('Media source returned an invalid redirect.');
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error('Too many redirects encountered while fetching media stream.');
}

/* ==========================================================================
   MODULE 1: INSTAGRAM API ENDPOINTS (FIX 1: No client sessionId)
   ========================================================================== */
async function handleInstagramVideo(req, res) {
  const { postUrl } = req.body;
  if (!postUrl) {
    return res.status(400).json({ error: 'Instagram Reel or Video URL is required.' });
  }

  try {
    const data = await getInstagramVideo(postUrl);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('[Instagram Video Error]', err.message);
    return res.status(400).json({ error: `Instagram Video Fetch Failed: ${err.message}` });
  }
}

async function handleInstagramAudio(req, res) {
  const { postUrl } = req.body;
  if (!postUrl) {
    return res.status(400).json({ error: 'Instagram Reel or Audio URL is required.' });
  }

  try {
    const data = await getInstagramAudio(postUrl);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('[Instagram Audio Error]', err.message);
    return res.status(400).json({ error: `Instagram Audio Fetch Failed: ${err.message}` });
  }
}

app.post('/api/instagram/video', heavyApiLimiter, handleInstagramVideo);
app.post('/api/instagram/song', heavyApiLimiter, handleInstagramAudio);

// Legacy routes for backward compatibility
app.post('/api/fetch-video-info', heavyApiLimiter, handleInstagramVideo);
app.post('/api/fetch-song-info', heavyApiLimiter, handleInstagramAudio);

/* ==========================================================================
   MODULE 2: YOUTUBE API ENDPOINTS (Isolated Fault-Tolerant)
   ========================================================================== */
app.use('/api/youtube', (req, res, next) => {
  if (!YOUTUBE_ENABLED) {
    return res.status(404).json({ error: 'YouTube downloader is not available yet.' });
  }
  next();
});

app.post('/api/youtube/video', heavyApiLimiter, async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'YouTube video or Shorts URL is required.' });
  }

  try {
    const data = await getYoutubeVideo(videoUrl);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('[YouTube Video Error]', err.message);
    return res.status(400).json({
      error: `YouTube Video Fetch Failed: ${err.message}`,
      platform: 'youtube'
    });
  }
});

app.post('/api/youtube/song', heavyApiLimiter, async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'YouTube video or Shorts URL is required.' });
  }

  try {
    const data = await getYoutubeAudio(videoUrl);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('[YouTube Audio Error]', err.message);
    return res.status(400).json({
      error: `YouTube Audio Fetch Failed: ${err.message}`,
      platform: 'youtube'
    });
  }
});

/* ==========================================================================
   MODULE 3: FACEBOOK API ENDPOINTS (Isolated Fault-Tolerant)
   ========================================================================== */
app.post('/api/facebook/video', heavyApiLimiter, async (req, res) => {
  const { postUrl } = req.body;
  if (!postUrl) {
    return res.status(400).json({ error: 'Facebook Reel or Video URL is required.' });
  }

  try {
    const data = await getFacebookVideo(postUrl);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('[Facebook Video Error]', err.message);
    return res.status(400).json({
      error: `Facebook Video Fetch Failed: ${err.message}`,
      platform: 'facebook'
    });
  }
});

app.post('/api/facebook/song', heavyApiLimiter, async (req, res) => {
  const { postUrl } = req.body;
  if (!postUrl) {
    return res.status(400).json({ error: 'Facebook Reel or Video URL is required.' });
  }

  try {
    const data = await getFacebookAudio(postUrl);
    return res.json({ success: true, ...data });
  } catch (err) {
    console.error('[Facebook Audio Error]', err.message);
    return res.status(400).json({
      error: `Facebook Audio Fetch Failed: ${err.message}`,
      platform: 'facebook'
    });
  }
});

/* ==========================================================================
   STREAM PROXY ROUTE (Zero-Storage, SSRF Whitelisted, Concurrency Limited, Real-Time FFmpeg MP3)
   ========================================================================== */
function formatContentDisposition(filename) {
  // Remove dangerous filesystem/header characters: / \ : * ? " < > | \r \n
  const safeName = (filename || 'download').trim().replace(/[\/\\:*?"<>|\r\n]/g, '').trim() || 'download';
  const asciiFallback = safeName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

// FIX 4: Concurrency cap for FFmpeg conversions
let activeFfmpegCount = 0;
const MAX_CONCURRENT_FFMPEG = 1; // Keep FFmpeg CPU use bounded on the configured free instance.

app.get('/api/download-stream', heavyApiLimiter, async (req, res) => {
  const { url, filename, type } = req.query;

  if (!url) return sendDownloadError(req, res, 400, 'Missing media URL');

  if (!YOUTUBE_ENABLED && isYoutubeMediaUrl(url)) {
    return sendDownloadError(req, res, 403, 'YouTube downloads are not available yet.');
  }

  // SSRF Protection: Initial Domain & IP Whitelist Validation
  if (!isAllowedCdnDomain(url)) {
    return sendDownloadError(req, res, 403, 'Forbidden: Target domain is not an authorized CDN server.');
  }

  // 1. REAL ON-THE-FLY MP3 CONVERSION (Zero-Storage Pipe)
  if (type === 'audio') {
    if (activeFfmpegCount >= MAX_CONCURRENT_FFMPEG) {
      return sendDownloadError(req, res, 429, 'Server is currently busy converting other audio tracks. Please retry in 10-15 seconds.');
    }

    activeFfmpegCount++;
    let baseName = String(filename || 'audio_track').replace(/\.[a-zA-Z0-9]+$/, '').trim();
    if (!baseName) baseName = 'audio_track';
    const cleanFilename = `${baseName}.mp3`;

    let isCleanedUp = false;
    let responseStarted = false;
    let failureHandled = false;
    let clientDisconnected = false;
    let upstreamStream;
    let ff;
    let failureMessage = 'FFmpeg process terminated with conversion error.';
    let timeoutTimer;
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      activeFfmpegCount = Math.max(0, activeFfmpegCount - 1);
    };

    res.on('close', () => {
      if (res.writableEnded) return;
      clientDisconnected = true;
      clearTimeout(timeoutTimer);
      cleanup();
      if (upstreamStream && !upstreamStream.destroyed) upstreamStream.destroy();
      if (ff && !ff.killed) ff.kill('SIGKILL');
    });

    try {
      const { response: sourceResponse } = await safeFetchStream(url, 5);
      upstreamStream = sourceResponse.data;
      if (clientDisconnected) {
        upstreamStream.destroy();
        return;
      }

      const ffmpegBin = ffmpegStatic || 'ffmpeg';
      ff = spawn(ffmpegBin, [
        '-loglevel', 'error',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        '-protocol_whitelist', 'pipe',
        '-i', 'pipe:0',
        '-vn',
        '-acodec', 'libmp3lame',
        '-b:a', '192k',
        '-ar', '44100',
        '-f', 'mp3',
        'pipe:1'
      ]);

      // Stop stalled jobs, but allow long media streams to finish.
      const resetWatchdog = () => {
        clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          console.warn('[FFmpeg Watchdog] Conversion stalled for 2 minutes, terminating.');
          failureMessage = 'Audio conversion timed out. Please try again.';
          if (ff && !ff.killed) ff.kill('SIGKILL');
        }, 120000);
      };
      resetWatchdog();
      upstreamStream.on('data', resetWatchdog);
      ff.stdout.on('data', resetWatchdog);

      ff.stderr.on('data', (chunk) => {
        const output = chunk.toString().trim();
        if (output) console.warn('[FFmpeg stderr]', output);
      });

      ff.stdout.once('data', (chunk) => {
        if (clientDisconnected) return;
        responseStarted = true;
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', formatContentDisposition(cleanFilename));
        res.setHeader('Cache-Control', 'no-cache');
        res.write(chunk);
        ff.stdout.pipe(res);
      });

      upstreamStream.on('error', (err) => {
        failureHandled = true;
        if (ff && !ff.killed) ff.kill('SIGKILL');
        if (!res.headersSent && !clientDisconnected) {
          sendDownloadError(req, res, 502, 'The media source ended unexpectedly. Please try again.');
        } else if (!res.destroyed) {
          res.destroy(err);
        }
      });
      ff.stdin.on('error', (err) => {
        if (err.code === 'EPIPE' || clientDisconnected) return;
        failureHandled = true;
        if (ff && !ff.killed) ff.kill('SIGKILL');
        if (!res.headersSent && !clientDisconnected) {
          sendDownloadError(req, res, 502, 'Audio conversion stopped before the file was ready. Please try again.');
        } else if (!res.destroyed) {
          res.destroy(err);
        }
      });
      upstreamStream.pipe(ff.stdin);

      ff.on('error', async (err) => {
        clearTimeout(timeoutTimer);
        cleanup();
        console.error('[FFmpeg Audio Conversion Error]', err.message);
        failureHandled = true;
        if (!res.headersSent && !clientDisconnected) {
          sendDownloadError(req, res, 500, `Failed to extract audio track: ${err.message}`);
        } else if (!res.destroyed) {
          res.destroy(err);
        }
      });

      ff.on('close', (code) => {
        clearTimeout(timeoutTimer);
        cleanup();
        if (!responseStarted && !failureHandled && !clientDisconnected) {
          failureHandled = true;
          sendDownloadError(req, res, 500, failureMessage);
        } else if (code !== 0 && responseStarted && !res.destroyed) {
          res.destroy(new Error(failureMessage));
        }
      });

      return;
    } catch (ffmpegErr) {
      clearTimeout(timeoutTimer);
      cleanup();
      console.warn('[FFmpeg Fallback Warning]', ffmpegErr.message);
      if (!res.headersSent && !clientDisconnected) {
        return sendDownloadError(req, res, 500, `Failed to start audio conversion: ${ffmpegErr.message}`);
      }
      return;
    }
  }

  // 2. VIDEO DOWNLOADS (Zero-Storage Direct Stream Proxy with Safe Redirect Validation)
  try {
    // FIX 3: Use safe stream fetcher that validates every redirect hop
    const { response: streamRes } = await safeFetchStream(url, 5);

    // FIX 5: Dynamic content-type, content-length, and extension detection
    const upstreamContentType = streamRes.headers['content-type'] || 'video/mp4';
    const upstreamContentLength = streamRes.headers['content-length'];
    const upstreamAcceptRanges = streamRes.headers['accept-ranges'];

    let extension = 'mp4';
    if (upstreamContentType.includes('webm')) {
      extension = 'webm';
    }

    let cleanFilename = filename ? String(filename).trim() : `video_download.${extension}`;
    if (!cleanFilename.toLowerCase().endsWith(`.${extension}`)) {
      cleanFilename = `${cleanFilename.replace(/\.[a-zA-Z0-9]+$/, '')}.${extension}`;
    }

    res.setHeader('Content-Type', upstreamContentType);
    res.setHeader('Content-Disposition', formatContentDisposition(cleanFilename));
    if (upstreamContentLength) {
      res.setHeader('Content-Length', upstreamContentLength);
    }
    if (upstreamAcceptRanges) {
      res.setHeader('Accept-Ranges', upstreamAcceptRanges);
    }

    // Release the upstream connection if the browser disconnects mid-download.
    res.on('close', () => {
      if (res.writableEnded) return;
      if (streamRes.data && typeof streamRes.data.destroy === 'function') {
        streamRes.data.destroy();
      }
    });

    streamRes.data.on('error', (err) => {
      console.warn('[Video Stream Error]', err.message);
      if (!res.headersSent) {
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Disposition');
        sendDownloadError(req, res, 502, 'The media stream ended unexpectedly. Please try again.');
      } else if (!res.destroyed) {
        res.destroy(err);
      }
    });

    streamRes.data.pipe(res);

  } catch (err) {
    if (!res.headersSent) {
      sendDownloadError(req, res, 500, `Failed to stream download: ${err.message}`);
    }
  }
});

/* ==========================================================================
   FIX 7: REAL HEALTH CHECK ENDPOINT
   ========================================================================== */
app.get('/health', (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    status: 'ok',
    service: 'MediaClipper',
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(memory.rss / (1024 * 1024)),
      heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024))
    },
    activeConversions: activeFfmpegCount,
    platforms: {
      instagram: {
        service: 'loaded',
        authentication: cookiePool.getPool().length > 0 ? 'configured' : 'public-only'
      },
      youtube: {
        service: 'loaded',
        enabled: YOUTUBE_ENABLED
      },
      facebook: {
        service: 'loaded',
        upstream: 'not-checked'
      }
    }
  });
});

/* ==========================================================================
   FIX 6: GLOBAL ERROR HANDLER & PROCESS PROTECTION
   ========================================================================== */
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((err, req, res, next) => {
  console.error('[Global Express Error Handler]', err);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error'
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 MediaClipper Multi-Platform Suite is running!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`✨ Platforms Available: Instagram, Facebook (YouTube disabled)`);
  console.log(`🔒 Zero-Storage Mode: ACTIVE (No data stored on disk)`);
  console.log(`🛡️ SSRF Protection & Safe Redirects: ENABLED`);
  console.log(`⚡ FFmpeg Concurrency Cap: Max ${MAX_CONCURRENT_FFMPEG} jobs`);
  console.log(`====================================================`);
});
