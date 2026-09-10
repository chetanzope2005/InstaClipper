import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable Reverse Proxy Trust (Required for Render, Vercel, Cloudflare, Nginx)
app.set('trust proxy', 1);

// Enable Gzip/Brotli HTTP Compression (Skip SSE streaming endpoint to prevent chunk buffering)
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/api/scrape-comments-stream' || (req.headers.accept && req.headers.accept.includes('text/event-stream'))) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Security Response Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://my-first-app-bv7n.onrender.com'
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed'));
  }
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false
}));


/* ==========================================================================
   RATE LIMITERS (Abuse & Bot Spam Protection)
   ========================================================================== */

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please try again after 15 minutes.' }
});

const heavyApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for scraping/download API. Please wait 1 minute before making another request.' }
});

const streamTokens = new Map();
const STREAM_TOKEN_TTL_MS = 5 * 60 * 1000;

function pruneStreamTokens() {
  const now = Date.now();
  for (const [token, entry] of streamTokens) {
    if (entry.expiresAt <= now) streamTokens.delete(token);
  }
}

app.post('/api/stream-token', heavyApiLimiter, (req, res) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
  if (!sessionId) return res.status(400).json({ error: 'Session ID is required.' });

  pruneStreamTokens();
  const token = randomUUID();
  streamTokens.set(token, {
    sessionId,
    expiresAt: Date.now() + STREAM_TOKEN_TTL_MS
  });
  return res.json({ token });
});

app.use('/api/', generalLimiter);

/**
 * SSRF PROTECTION: Domain & IP Whitelist Validator
 * Strict check ensuring target URL belongs ONLY to Meta/Instagram CDN servers.
 * Blocks private IP ranges (127.0.0.1, 169.254.169.254, 10.x, 192.168.x) and non-Meta domains.
 */
function isAllowedCdnDomain(targetUrl) {
  try {
    const parsed = new URL(targetUrl);

    // Protocol check
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

    // Allowed Instagram & Meta CDN Domains + Giphy CDN
    const allowedDomains = [
      'cdninstagram.com',
      'instagram.com',
      'fbcdn.net',
      'facebook.com',
      'giphy.com',
      'giphy.media'
    ];

    return allowedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch (err) {
    return false;
  }
}

/**
 * Extracts Instagram shortcode from URL
 */
function parseShortcode(inputUrl) {
  if (!inputUrl) return null;
  const cleanInput = inputUrl.trim();
  const match = cleanInput.match(/(?:instagram\.com\/(?:p|reel|tv)\/)([A-Za-z0-9_-]+)/i);
  if (match && match[1]) {
    return match[1];
  }
  if (/^[A-Za-z0-9_-]{5,25}$/.test(cleanInput)) {
    return cleanInput;
  }
  return null;
}

/**
 * Converts Instagram shortcode to numeric Media ID (BigInt conversion)
 */
function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (let i = 0; i < shortcode.length; i++) {
    const char = shortcode[i];
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid shortcode character '${char}' in '${shortcode}'`);
    }
    id = id * BigInt(64) + BigInt(index);
  }
  return id.toString();
}

function getCleanPostUrl(shortcode) {
  return `https://www.instagram.com/reel/${shortcode}/`;
}

/**
 * Comprehensive GIF Media Extractor for Instagram Comments
 */
function extractGifUrlFromItem(item) {
  if (!item || typeof item !== 'object') return '';

  // 1. Direct properties
  if (item.gifUrl && typeof item.gifUrl === 'string') return item.gifUrl;
  if (item.gif_url && typeof item.gif_url === 'string') return item.gif_url;
  if (item.giphy_url && typeof item.giphy_url === 'string') return item.giphy_url;
  if (item.giphy_media_url && typeof item.giphy_media_url === 'string') return item.giphy_media_url;

  // 2. Check giphy_media_info and common sub-objects
  const mediaContainers = [
    item.giphy_media_info,
    item.giphy_media,
    item.animated_media,
    item.custom_media,
    item.comment_media?.giphy_media_info,
    item.comment_media,
    item.comment_index_media,
    item.media?.giphy_media_info,
    item.media,
    item.media_info
  ];

  for (const container of mediaContainers) {
    if (!container || typeof container !== 'object') continue;

    // Check images inside container
    const images = container.images || container.media_info?.images;
    if (images) {
      if (images.original?.url) return images.original.url;
      if (images.fixed_height?.url) return images.fixed_height.url;
      if (images.fixed_width?.url) return images.fixed_width.url;
      if (images.downsized?.url) return images.downsized.url;
      if (images.downsized_large?.url) return images.downsized_large.url;
      if (images.downsized_medium?.url) return images.downsized_medium.url;
    }

    // Check direct url/gif_url/embed_url
    if (container.gif_url) return container.gif_url;
    if (container.url && (container.url.includes('.gif') || container.url.includes('giphy') || container.url.includes('cdninstagram'))) return container.url;
    if (container.embed_url) return container.embed_url;

    // Check image_versions2
    if (container.image_versions2?.candidates?.[0]?.url) {
      return container.image_versions2.candidates[0].url;
    }

    // Check Giphy ID
    const gId = container.id || container.giphy_id || container.media_id;
    if (gId && typeof gId === 'string' && /^[a-zA-Z0-9_-]+$/.test(gId) && gId.length > 5) {
      return `https://media.giphy.com/media/${gId}/giphy.gif`;
    }
  }

  // 3. Text regex check: Does item.text contain a Giphy link or .gif link?
  if (typeof item.text === 'string') {
    const giphyMatch = item.text.match(/https?:\/\/(?:media\d*|i|giphy)\.giphy\.com\/[^\s"'>]+\.gif/i) ||
                       item.text.match(/https?:\/\/(?:giphy\.com|media\.giphy\.com)\/gifs\/[^\s"'>]+/i) ||
                       item.text.match(/https?:\/\/[^\s"'>]+\.gif(?:\?[^\s"'>]*)?/i);
    if (giphyMatch) {
      return giphyMatch[0];
    }
  }

  // 4. Fallback: Deep JSON string match for any Giphy GIF URL or .gif URL
  try {
    const jsonStr = JSON.stringify(item);
    const gifMatch = jsonStr.match(/https?:\\?\/\\?\/media\d*\.giphy\.com\\?\/media\\?\/[a-zA-Z0-9_-]+\\?\/(?:giphy|200|fixed_height|original)\.gif/i) ||
                     jsonStr.match(/https?:\\?\/\\?\/[^\s"'\\]+\.gif(?:\?[^\s"'\\]*)?/i);
    if (gifMatch) {
      return gifMatch[0].replace(/\\\//g, '/');
    }
  } catch (e) {}

  return '';
}

function formatSingleComment(item) {
  const gifUrl = extractGifUrlFromItem(item);
  let rawText = (item.text || '').trim();

  // Clean up raw text if it's Instagram's placeholder string for pure GIF comments (e.g. '"" >', '""', '""&gt;')
  if (/^""\s*>?$/i.test(rawText) || /^""\s*&gt;?$/i.test(rawText) || rawText === '""') {
    rawText = '';
  }

  return {
    id: item.pk || item.id,
    text: rawText,
    username: item.user?.username || 'unknown',
    fullName: item.user?.full_name || '',
    profilePic: item.user?.profile_pic_url || '',
    isVerified: Boolean(item.user?.is_verified),
    isPinned: Boolean(item.is_pinned || item.pinned || item.pinned_comment_info),
    gifUrl: gifUrl,
    createdAt: item.created_at || Math.floor(Date.now() / 1000),
    createdAtFormatted: item.created_at
      ? new Date(item.created_at * 1000).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    likesCount: item.comment_like_count || 0
  };
}

function getInstagramHeaders(sessionId) {
  // Decode URL-encoded session IDs (e.g. %3A -> :)
  let cleanSessionId = sessionId ? sessionId.trim().replace(/^sessionid=/, '') : '';
  try {
    if (cleanSessionId.includes('%')) {
      cleanSessionId = decodeURIComponent(cleanSessionId);
    }
  } catch (e) {}

  const match = cleanSessionId.match(/^(\d+)(?::|%3A)/i);
  const dsUserId = match ? match[1] : '';

  let cookieHeader = `sessionid=${cleanSessionId};`;
  if (dsUserId) {
    cookieHeader += ` ds_user_id=${dsUserId};`;
  }
  // Add csrftoken placeholder so Instagram accepts the session
  cookieHeader += ' csrftoken=absent;';

  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'X-IG-App-ID': '936619743392459',
    'X-ASBD-ID': '129477',
    'Cookie': cookieHeader,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.instagram.com',
    'Referer': 'https://www.instagram.com/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'X-Requested-With': 'XMLHttpRequest'
  };
}

/**
 * ==============================================================================
 * BACKEND COOKIE POOL MANAGER (Dummy / Secondary Accounts)
 * Automatically distributes requests, rotates cookies, and cools down rate-limited accounts.
 * ==============================================================================
 */
class CookiePoolManager {
  constructor() {
    this.index = 0;
    this.cooldowns = new Map();
  }

  getPool() {
    const list = [];
    for (let i = 1; i <= 20; i++) {
      const val = process.env[`INSTA_COOKIE_${i}`];
      if (val && val.trim()) {
        const clean = val.trim().replace(/^sessionid=/, '');
        if (clean && !list.includes(clean)) list.push(clean);
      }
    }
    if (process.env.INSTA_SESSION_IDS) {
      process.env.INSTA_SESSION_IDS.split(/[,;\n]/).forEach(c => {
        const clean = c.trim().replace(/^sessionid=/, '');
        if (clean && !list.includes(clean)) list.push(clean);
      });
    }
    if (process.env.SESSION_ID) {
      const clean = process.env.SESSION_ID.trim().replace(/^sessionid=/, '');
      if (clean && !list.includes(clean)) list.push(clean);
    }
    return list;
  }

  getNextSessionId(userProvidedSessionId) {
    // 1. If user provided their own custom session ID for "Fastest Mode", use it!
    if (userProvidedSessionId && userProvidedSessionId.trim()) {
      return userProvidedSessionId.trim().replace(/^sessionid=/, '');
    }

    // 2. Otherwise pick from backend cookie pool (.env)
    const pool = this.getPool();
    if (pool.length === 0) {
      return null;
    }

    const now = Date.now();
    const healthy = pool.filter(c => {
      const cd = this.cooldowns.get(c) || 0;
      return now > cd;
    });

    const candidatePool = healthy.length > 0 ? healthy : pool;
    const selected = candidatePool[this.index % candidatePool.length];
    this.index = (this.index + 1) % candidatePool.length;
    return selected;
  }

  markCooldown(cookie, cooldownMinutes = 10) {
    if (!cookie) return;
    const clean = cookie.trim().replace(/^sessionid=/, '');
    this.cooldowns.set(clean, Date.now() + cooldownMinutes * 60 * 1000);
    console.warn(`[CookiePool] Session ID (...${clean.slice(-6)}) cooled down for ${cooldownMinutes}m to protect account.`);
  }
}

const cookiePool = new CookiePoolManager();

/**
 * LAYER 1: PUBLIC EMBED & OPENGRAPH META SCRAPER (ZERO LOGIN / ZERO COOKIES)
 * Uses Instagram oEmbed API + web scraping fallbacks for public Reels and Posts.
 */
async function fetchMediaPublic(shortcode) {
  const errors = [];

  // Strategy 1: Use Instagram's public oEmbed API to get basic metadata
  // Then scrape the reel page with a bot user-agent to extract video URL
  let oembedData = null;
  try {
    const oembedRes = await axios.get(
      `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent('https://www.instagram.com/reel/' + shortcode + '/')}`,
      { timeout: 8000, validateStatus: s => s === 200 }
    );
    oembedData = oembedRes.data;
  } catch (e) {
    try {
      const oembedRes2 = await axios.get(
        `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent('https://www.instagram.com/p/' + shortcode + '/')}`,
        { timeout: 8000, validateStatus: s => s === 200 }
      );
      oembedData = oembedRes2.data;
    } catch (e2) {
      errors.push(`oembed: ${e2.message}`);
    }
  }

  // Strategy 2: Scrape the reel page with facebookexternalhit bot user-agent
  // to extract video URL from OpenGraph tags or page data
  for (const pageUrl of [
    `https://www.instagram.com/reel/${shortcode}/`,
    `https://www.instagram.com/p/${shortcode}/`
  ]) {
    try {
      const res = await axios.get(pageUrl, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: s => s < 400
      });

      const html = String(res.data || '');

      // Extract video URL from various patterns
      let videoUrl = '';
      
      // Pattern 1: og:video meta tag
      const ogVideo = html.match(/property="og:video(?::secure_url)?"[^>]*content="([^"]+)"/i) ||
                      html.match(/content="([^"]+)"[^>]*property="og:video(?::secure_url)?"/i) ||
                      html.match(/property='og:video(?::secure_url)?'[^>]*content='([^']+)'/i);
      if (ogVideo) videoUrl = ogVideo[1].replace(/&amp;/g, '&');

      // Pattern 2: JSON data in page scripts (SharedData)
      if (!videoUrl) {
        const jsonMatch = html.match(/"video_url"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/i);
        if (jsonMatch) videoUrl = jsonMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }

      // Pattern 3: video_versions in JSON
      if (!videoUrl) {
        const vvMatch = html.match(/"video_versions".*?"url"\s*:\s*"(https?:[^"]+)"/i);
        if (vvMatch) videoUrl = vvMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }

      // Extract thumbnail from og:image
      let thumbnail = '';
      const ogImage = html.match(/property="og:image"[^>]*content="([^"]+)"/i) ||
                      html.match(/content="([^"]+)"[^>]*property="og:image"/i);
      if (ogImage) thumbnail = ogImage[1].replace(/&amp;/g, '&');

      // Extract caption from og:title or og:description
      let caption = '';
      const ogDesc = html.match(/property="og:description"[^>]*content="([^"]+)"/i) ||
                     html.match(/content="([^"]+)"[^>]*property="og:description"/i) ||
                     html.match(/property="og:title"[^>]*content="([^"]+)"/i);
      if (ogDesc) caption = ogDesc[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');

      // Get username from oembed or page
      const username = oembedData?.author_name || 'instagram_creator';

      if (videoUrl) {
        console.log(`[PublicScraper] Found video via bot-scraper for ${shortcode}: ${videoUrl.substring(0, 60)}...`);
        return {
          video_versions: [{ url: videoUrl, width: 1080, height: 1920 }],
          image_versions2: { candidates: [{ url: thumbnail }] },
          caption: { text: caption },
          user: { username }
        };
      }

      // Strategy 2b: If no video URL but we have thumbnail from oembed, it might be an image post
      if (thumbnail && oembedData) {
        // Return thumbnail as image (not a video post)
        return {
          video_versions: [],
          image_versions2: { candidates: [{ url: thumbnail }] },
          caption: { text: caption },
          user: { username }
        };
      }
    } catch (e) {
      errors.push(`scrape_${pageUrl}: ${e.message}`);
    }
  }

  // Strategy 3: Try Instagram embed/captioned page
  for (const embedUrl of [
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`
  ]) {
    try {
      const res = await axios.get(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Mode': 'navigate'
        },
        timeout: 7000,
        validateStatus: s => s === 200
      });

      const html = String(res.data || '');

      let videoUrl = '';
      const vMatch = html.match(/class="EmbeddedVideo"[^>]*src="([^"]+)"/i) ||
                     html.match(/<video[^>]*src="([^"]+)"/i) ||
                     html.match(/"video_url"\s*:\s*"([^"]+)"/i) ||
                     html.match(/property="og:video(?::secure_url)?"[^>]*content="([^"]+)"/i);

      if (vMatch && vMatch[1]) {
        videoUrl = vMatch[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      }

      const tMatch = html.match(/class="EmbeddedVideoImage"[^>]*src="([^"]+)"/i) ||
                     html.match(/property="og:image"[^>]*content="([^"]+)"/i);
      let thumbnail = tMatch ? tMatch[1].replace(/&amp;/g, '&') : '';

      const cMatch = html.match(/property="og:title"[^>]*content="([^"]+)"/i) ||
                     html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
      let caption = cMatch ? cMatch[1].replace(/<[^>]+>/g, '').trim().replace(/&quot;/g, '"') : '';

      const username = oembedData?.author_name || 'instagram_creator';

      if (videoUrl) {
        console.log(`[PublicScraper] Found video via embed for ${shortcode}`);
        return {
          video_versions: [{ url: videoUrl, width: 1080, height: 1920 }],
          image_versions2: { candidates: [{ url: thumbnail }] },
          caption: { text: caption },
          user: { username }
        };
      }
    } catch (e) {
      errors.push(`embed: ${e.message}`);
    }
  }

  console.log(`[PublicScraper] All public strategies failed for ${shortcode}: ${errors.join(' | ')}`);
  return null;
}

/**
 * OpenGraph Meta Scraper (Bot User-Agent)
 */
async function fetchMediaFromHtml(shortcode) {
  const cleanUrl = getCleanPostUrl(shortcode);
  const botHeaders = {
    'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  const response = await axios.get(cleanUrl, {
    headers: botHeaders,
    timeout: 8000,
    maxRedirects: 5,
    validateStatus: s => s < 400
  });

  const html = String(response.data || '');
  
  let videoUrl = '';
  const vMatch = html.match(/<meta\s+(?:property|name)=["']og:video["']\s+content=["']([^"']+)["']/i) ||
                 html.match(/content=["']([^"']+)["']\s+(?:property|name)=["']og:video["']/i) ||
                 html.match(/"video_url"\s*:\s*"([^"]+)"/);
  
  if (vMatch && vMatch[1]) {
    videoUrl = vMatch[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  }

  let thumbnail = '';
  const imgMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                   html.match(/content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i) ||
                   html.match(/"display_url"\s*:\s*"([^"]+)"/);
  if (imgMatch && imgMatch[1]) {
    thumbnail = imgMatch[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
  }

  let caption = '';
  const tMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                 html.match(/<title>([^<]+)<\/title>/i);
  if (tMatch && tMatch[1]) {
    caption = tMatch[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'");
  }

  if (!videoUrl) {
    throw new Error('HTML meta scraper could not find og:video tag.');
  }

  return {
    videoUrl,
    thumbnail,
    caption,
    username: 'instagram_user',
    width: 1080,
    height: 1920
  };
}

/**
 * Multi-Layer Bulletproof Instagram Media Extractor Engine
 * Layer 1: Public Scraping (Zero Login / Zero Cookies Required)
 * Layer 2: /api/v1/media/{mediaId}/info/ with authenticated session (follows redirects)
 * Layer 3: /api/graphql/ (modern GraphQL - authenticated)
 * Layer 4: /api/v1/media/by_url/ (Authenticated)
 */
async function fetchInstagramMediaItem(shortcode, mediaId, headers) {
  const errors = [];

  // LAYER 1: Public Scraping (Zero Login / Zero Cookies Required)
  try {
    const publicItem = await fetchMediaPublic(shortcode);
    if (publicItem && publicItem.video_versions && publicItem.video_versions.length > 0) {
      return publicItem;
    }
    if (publicItem) {
      errors.push('public_layer: found but no video_versions');
    }
  } catch (e0) {
    errors.push(`public_layer: ${e0.message}`);
  }

  // LAYER 2: /api/v1/media/{mediaId}/info/ with session cookie
  // Note: Instagram redirects HTTP -> HTTPS then to the same URL (self-redirect)
  // We need to detect this and retry with the final URL directly
  if (headers && headers.Cookie && mediaId && mediaId !== '0') {
    try {
      const infoUrl = `https://www.instagram.com/api/v1/media/${mediaId}/info/`;
      // First request to check if it redirects
      const res1 = await axios.get(infoUrl, {
        headers: { ...headers, 'Referer': `https://www.instagram.com/reel/${shortcode}/` },
        timeout: 12000,
        maxRedirects: 0,
        validateStatus: s => true
      });

      let finalData = null;
      if (res1.status === 200 && res1.data?.items?.[0]) {
        finalData = res1.data;
      } else if ((res1.status === 301 || res1.status === 302) && res1.headers?.location) {
        // Follow the redirect once manually to avoid redirect loops
        const redirectUrl = res1.headers.location.startsWith('http')
          ? res1.headers.location
          : `https://www.instagram.com${res1.headers.location}`;
        try {
          const res1b = await axios.get(redirectUrl, {
            headers: { ...headers, 'Referer': `https://www.instagram.com/reel/${shortcode}/` },
            timeout: 10000,
            maxRedirects: 0,
            validateStatus: s => true
          });
          if (res1b.status === 200 && res1b.data?.items?.[0]) {
            finalData = res1b.data;
          }
        } catch(er) {
          errors.push(`media_info_redirect: ${er.message}`);
        }
      }

      if (finalData?.items?.[0]) {
        return finalData.items[0];
      }
      if (res1.status === 401 || res1.status === 403) {
        errors.push(`media_info: HTTP ${res1.status} - session invalid or expired`);
      } else {
        errors.push(`media_info: HTTP ${res1.status} - no items in response`);
      }
    } catch (e1) {
      errors.push(`media_info: ${e1.message}`);
    }
  }

  // LAYER 3: Modern Instagram GraphQL API (authenticated)
  if (headers && headers.Cookie) {
    try {
      // Use the newer Instagram web API endpoint
      const docId = '8845758582119845'; // Reel/Post media info doc ID
      const variables = JSON.stringify({ shortcode, __relay_internal__pv__IG_REELS_VIDEO_TILES_AND_BADGES_ENABLEDrelayprovider: false });
      const gqlUrl = `https://www.instagram.com/api/graphql`;
      const gqlRes = await axios.post(gqlUrl, new URLSearchParams({
        variables,
        doc_id: docId
      }).toString(), {
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `https://www.instagram.com/reel/${shortcode}/`
        },
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: s => true
      });

      if (gqlRes.status === 200 && typeof gqlRes.data === 'object') {
        const media = gqlRes.data?.data?.xdt_shortcode_media;
        if (media) {
          return {
            video_versions: media.video_url ? [{ url: media.video_url, width: media.dimensions?.width || 1080, height: media.dimensions?.height || 1920 }] : [],
            image_versions2: { candidates: [{ url: media.display_url || '' }] },
            caption: { text: media.edge_media_to_caption?.edges?.[0]?.node?.text || '' },
            user: { username: media.owner?.username || 'user' },
            clips_metadata: media.clips_metadata
          };
        }
      }
    } catch (e3) {
      errors.push(`graphql_v2: ${e3.message}`);
    }
  }

  // LAYER 4: /api/v1/media/by_url/
  if (headers && headers.Cookie) {
    try {
      const cleanUrl = getCleanPostUrl(shortcode);
      const byUrlEndpoint = `https://www.instagram.com/api/v1/media/by_url/?url=${encodeURIComponent(cleanUrl)}`;
      const res2 = await axios.get(byUrlEndpoint, {
        headers,
        timeout: 9000,
        maxRedirects: 0,
        validateStatus: s => true
      });
      if (res2.status === 200 && res2.data?.items?.[0]) {
        return res2.data.items[0];
      }
    } catch (e2) {
      errors.push(`by_url: ${e2.message}`);
    }
  }

  throw new Error(`Media fetch failed across all layers (${errors.join(' | ')})`);
}

/* ==========================================================================
   FEATURE 1: INSTAGRAM GIVEAWAY WINNER PICKER & COMMENT SCRAPER API
   ========================================================================== */
app.post('/api/scrape-comments', heavyApiLimiter, async (req, res) => {
  const { postUrl, sessionId } = req.body;

  if (!postUrl) {
    return res.status(400).json({ error: 'Instagram Post or Reel URL is required.' });
  }

  const effectiveSessionId = cookiePool.getNextSessionId(sessionId);
  if (!effectiveSessionId) {
    return res.status(400).json({
      error: 'No Instagram Session ID available. Please configure backend dummy accounts in server .env (INSTA_COOKIE_1) or provide a custom Session ID in the app.'
    });
  }

  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    return res.status(400).json({ error: 'Invalid Instagram URL format.' });
  }

  let mediaId;
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    return res.status(400).json({ error: `Shortcode conversion error: ${err.message}` });
  }

  const headers = getInstagramHeaders(effectiveSessionId);
  const commentsList = [];
  let minId = '';
  let maxId = '';
  let hasMore = true;
  let pageCount = 0;
  const maxPages = 300;
  let instagramTotalCount = 0;

  try {
    while (hasMore && pageCount < maxPages) {
      pageCount++;
      let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true`;
      if (minId) {
        url += `&min_id=${encodeURIComponent(minId)}`;
      } else if (maxId) {
        url += `&max_id=${encodeURIComponent(maxId)}`;
      }

      const response = await axios.get(url, { headers, timeout: 7000, maxRedirects: 0, validateStatus: s => s < 500 });

      // Detect HTML response (Instagram login wall / checkpoint / redirect)
      if (typeof response.data === 'string' && (response.data.includes('<html') || response.data.includes('login') || response.data.includes('checkpoint'))) {
        cookiePool.markCooldown(effectiveSessionId, 30);
        return res.status(401).json({ 
          error: 'Instagram Session ID has expired or been challenged by Instagram. Please paste an active Session ID in the "Advanced: Custom Session ID" accordion above.' 
        });
      }

      if (response.status === 401 || response.status === 403) {
        cookiePool.markCooldown(effectiveSessionId, 15);
        return res.status(401).json({ error: 'Instagram Session ID is invalid or expired. Please provide an active Session ID.' });
      }

      if (response.status === 404) {
        return res.status(404).json({ error: 'Post not found or is private.' });
      }

      if (response.status === 429) {
        cookiePool.markCooldown(effectiveSessionId, 10);
        return res.status(429).json({ error: 'Instagram rate limit reached. Please retry in 1-2 minutes or use your own Session ID.' });
      }

      const data = response.data;
      if (!data || data.status !== 'ok') {
        if (commentsList.length > 0) break;
        return res.status(400).json({ error: data?.message || 'Instagram did not return comments for this post. Please verify post is public and Session ID is active.' });
      }


      if (data.comment_count) instagramTotalCount = data.comment_count;

      const rawComments = data.comments || [];
      if (rawComments.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of rawComments) {
        const commentObj = formatSingleComment(item);
        commentObj.childCommentCount = item.child_comment_count || 0;
        
        const initialReplies = (item.preview_child_comments || item.child_comments || []).map(formatSingleComment);
        const replyMap = new Map();
        initialReplies.forEach(r => replyMap.set(String(r.id), r));

        // Fetch child comment replies if more exist
        if (item.child_comment_count > replyMap.size) {
          let childHasMore = true;
          let childMinId = '';
          let childPage = 0;

          while (childHasMore && childPage < 3) {
            childPage++;
            try {
              let childUrl = `https://www.instagram.com/api/v1/media/${mediaId}/comments/${item.pk}/child_comments/`;
              if (childMinId) childUrl += `?min_id=${encodeURIComponent(childMinId)}`;

              const childRes = await axios.get(childUrl, { headers, timeout: 6000, maxRedirects: 0, validateStatus: () => true });
              if (childRes.data && childRes.data.child_comments) {
                const fetchedChilds = childRes.data.child_comments.map(formatSingleComment);
                fetchedChilds.forEach(r => replyMap.set(String(r.id), r));
                childMinId = childRes.data.next_min_id || childRes.data.next_max_id || '';
                childHasMore = Boolean(childRes.data.has_more_comments || childRes.data.has_more_headload_comments) && Boolean(childMinId);
              } else {
                childHasMore = false;
              }
            } catch (e) {
              childHasMore = false;
            }
          }
        }

        commentObj.replies = Array.from(replyMap.values());
        commentsList.push(commentObj);
      }

      minId = data.next_min_id || data.next_max_id || '';
      maxId = data.next_max_id || '';
      hasMore = Boolean(data.has_more_comments || data.has_more_headload_comments) && Boolean(minId || maxId);

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const totalRepliesCount = commentsList.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0);
    const combinedTotal = commentsList.length + totalRepliesCount;

    return res.json({
      success: true,
      shortcode,
      mediaId,
      instagramTotalCount: instagramTotalCount || combinedTotal,
      parentCount: commentsList.length,
      repliesCount: totalRepliesCount,
      combinedTotal: combinedTotal,
      comments: commentsList
    });

  } catch (err) {
    if (commentsList.length > 0) {
      const totalRepliesCount = commentsList.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0);
      return res.json({
        success: true,
        shortcode,
        mediaId,
        parentCount: commentsList.length,
        repliesCount: totalRepliesCount,
        combinedTotal: commentsList.length + totalRepliesCount,
        comments: commentsList,
        warning: `Scraping stopped early: ${err.message}`
      });
    }

    return res.status(500).json({ error: `Server Error: ${err.message}` });
  }
});

/**
 * REAL-TIME STREAMING COMMENT SCRAPER (Server-Sent Events)
 * Streams comment pages live to the client as they arrive in background
 */
app.get('/api/scrape-comments-stream', heavyApiLimiter, async (req, res) => {
  const { postUrl, token } = req.query;

  if (!postUrl) {
    return res.status(400).json({ error: 'Instagram Post or Reel URL is required.' });
  }

  pruneStreamTokens();
  const tokenEntry = streamTokens.get(token);
  if (!tokenEntry) {
    return res.status(401).json({ error: 'The comment stream token is missing or expired. Please try again.' });
  }
  streamTokens.delete(token);

  const effectiveSessionId = cookiePool.getNextSessionId(tokenEntry.sessionId);
  if (!effectiveSessionId) {
    return res.status(400).json({
      error: 'No active Instagram Session ID available. Please configure backend dummy accounts in server .env (INSTA_COOKIE_1) or provide a custom Session ID in the app.'
    });
  }

  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    return res.status(400).json({ error: 'Invalid Instagram URL format.' });
  }

  let mediaId;
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    return res.status(400).json({ error: `Shortcode conversion error: ${err.message}` });
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  const headers = getInstagramHeaders(effectiveSessionId);
  let minId = '';
  let maxId = '';
  let hasMore = true;
  let pageCount = 0;
  const maxPages = 300;
  let totalCommentsSent = 0;

  // Clean stream closure if user cancels or navigates away
  req.on('close', () => {
    hasMore = false;
  });

  try {
    while (hasMore && pageCount < maxPages) {
      pageCount++;
      let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true`;
      if (minId) {
        url += `&min_id=${encodeURIComponent(minId)}`;
      } else if (maxId) {
        url += `&max_id=${encodeURIComponent(maxId)}`;
      }

      const response = await axios.get(url, { headers, timeout: 7000, maxRedirects: 0, validateStatus: s => s < 500 });

      // Detect HTML response (Instagram login wall / checkpoint / redirect)
      if (typeof response.data === 'string' && (response.data.includes('<html') || response.data.includes('login') || response.data.includes('checkpoint'))) {
        cookiePool.markCooldown(effectiveSessionId, 30);
        res.write(`data: ${JSON.stringify({ 
          type: 'error', 
          error: 'Instagram Session ID has expired or been challenged by Instagram. Please paste an active Session ID in the "Advanced: Custom Session ID" accordion above.' 
        })}\n\n`);
        return res.end();
      }

      if (response.status === 401 || response.status === 403) {
        cookiePool.markCooldown(effectiveSessionId, 15);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Instagram Session ID is invalid or expired. Please provide an active Session ID in the accordion above.' })}\n\n`);
        return res.end();
      }

      if (response.status === 429) {
        cookiePool.markCooldown(effectiveSessionId, 10);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Instagram rate limit reached. Please wait 1-2 minutes or enter your own Session ID.' })}\n\n`);
        return res.end();
      }

      if (response.status === 404) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Post not found or is private.' })}\n\n`);
        return res.end();
      }

      const data = response.data;
      if (!data || data.status !== 'ok') {
        if (totalCommentsSent === 0) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: data?.message || 'Instagram did not return comments. Please verify URL or update Session ID.' })}\n\n`);
          return res.end();
        }
        break;
      }


      const rawComments = data.comments || [];
      if (rawComments.length === 0) {
        hasMore = false;
        break;
      }

      const pageComments = [];
      for (const item of rawComments) {
        const commentObj = formatSingleComment(item);
        commentObj.childCommentCount = item.child_comment_count || 0;
        
        const initialReplies = (item.preview_child_comments || item.child_comments || []).map(formatSingleComment);
        const replyMap = new Map();
        initialReplies.forEach(r => replyMap.set(String(r.id), r));

        if (item.child_comment_count > replyMap.size) {
          let childHasMore = true;
          let childMinId = '';
          let childPage = 0;

          while (childHasMore && childPage < 2) {
            childPage++;
            try {
              let childUrl = `https://www.instagram.com/api/v1/media/${mediaId}/comments/${item.pk}/child_comments/`;
              if (childMinId) childUrl += `?min_id=${encodeURIComponent(childMinId)}`;

              const childRes = await axios.get(childUrl, { headers, timeout: 5000, maxRedirects: 0, validateStatus: () => true });
              if (childRes.data && childRes.data.child_comments) {
                const fetchedChilds = childRes.data.child_comments.map(formatSingleComment);
                fetchedChilds.forEach(r => replyMap.set(String(r.id), r));
                childMinId = childRes.data.next_min_id || childRes.data.next_max_id || '';
                childHasMore = Boolean(childRes.data.has_more_comments || childRes.data.has_more_headload_comments) && Boolean(childMinId);
              } else {
                childHasMore = false;
              }
            } catch (e) {
              childHasMore = false;
            }
          }
        }

        commentObj.replies = Array.from(replyMap.values());
        pageComments.push(commentObj);
      }

      totalCommentsSent += pageComments.length;
      totalCommentsSent += pageComments.reduce((count, comment) => count + (comment.replies?.length || 0), 0);

      let instagramTotalCount = data.comment_count || 0;

      // Send live batch to client
      res.write(`data: ${JSON.stringify({ type: 'batch', comments: pageComments, shortcode, mediaId, totalCommentsSent, instagramTotalCount })}\n\n`);
      if (typeof res.flush === 'function') res.flush();

      minId = data.next_min_id || data.next_max_id || '';
      maxId = data.next_max_id || '';
      hasMore = Boolean(data.has_more_comments || data.has_more_headload_comments) && Boolean(minId || maxId);

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', totalCommentsSent })}\n\n`);
    if (typeof res.flush === 'function') res.flush();
    res.end();

  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'done', warning: err.message, totalCommentsSent })}\n\n`);
    if (typeof res.flush === 'function') res.flush();
    res.end();
  }
});

/* ==========================================================================
   FEATURE 2: INSTAGRAM VIDEO DOWNLOADER API
   ========================================================================== */
app.post('/api/fetch-video-info', heavyApiLimiter, async (req, res) => {
  const { postUrl, sessionId } = req.body;

  if (!postUrl) {
    return res.status(400).json({ error: 'Instagram Reel or Video URL is required.' });
  }

  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    return res.status(400).json({ error: 'Invalid Instagram Video/Reel URL.' });
  }

  let mediaId = '0';
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    mediaId = '0';
  }

  const effectiveSessionId = cookiePool.getNextSessionId(sessionId);
  const headers = effectiveSessionId ? getInstagramHeaders(effectiveSessionId) : {};

  try {
    const item = await fetchInstagramMediaItem(shortcode, mediaId, headers);

    const videoVersions = item.video_versions || item.video_resources || [];
    if (!videoVersions || videoVersions.length === 0) {
      return res.status(400).json({ error: 'This Instagram post does not contain a video file.' });
    }

    const bestVideo = videoVersions[0];
    const videoUrl = bestVideo.url || bestVideo.src;
    const thumbnail = item.image_versions2?.candidates?.[0]?.url || item.display_url || '';
    const caption = item.caption?.text || item.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    const username = item.user?.username || item.owner?.username || 'instagram_user';
    const width = bestVideo.width || 1080;
    const height = bestVideo.height || 1920;

    return res.json({
      success: true,
      shortcode,
      videoUrl,
      width,
      height,
      thumbnail,
      caption,
      username
    });

  } catch (err) {
    return res.status(400).json({ error: `Failed to fetch video: ${err.message}` });
  }
});

/* ==========================================================================
   FEATURE 3: INSTAGRAM SONG / AUDIO DOWNLOADER API
   ========================================================================== */
app.post('/api/fetch-song-info', heavyApiLimiter, async (req, res) => {
  const { postUrl, sessionId } = req.body;

  if (!postUrl) {
    return res.status(400).json({ error: 'Instagram Reel or Audio URL is required.' });
  }

  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    return res.status(400).json({ error: 'Invalid Instagram Reel/Audio URL.' });
  }

  let mediaId = '0';
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    mediaId = '0';
  }

  const effectiveSessionId = cookiePool.getNextSessionId(sessionId);
  const headers = effectiveSessionId ? getInstagramHeaders(effectiveSessionId) : {};

  try {
    const item = await fetchInstagramMediaItem(shortcode, mediaId, headers);

    let audioUrl = '';
    let title = 'Original Audio';
    let artist = item.user?.username || item.owner?.username || 'Instagram Artist';
    let artwork = item.image_versions2?.candidates?.[0]?.url || item.display_url || '';
    let isVideoFallback = false;

    const musicInfo = item.clips_metadata?.music_info?.music_asset_info;
    const soundInfo = item.clips_metadata?.original_sound_info;

    if (musicInfo && musicInfo.progressive_download_url) {
      audioUrl = musicInfo.progressive_download_url;
      title = musicInfo.title || title;
      artist = musicInfo.display_artist || artist;
      if (musicInfo.cover_artwork_thumbnail_uri) {
        artwork = musicInfo.cover_artwork_thumbnail_uri;
      }
    } else if (soundInfo && soundInfo.progressive_download_url) {
      audioUrl = soundInfo.progressive_download_url;
      title = soundInfo.original_audio_title || title;
      artist = soundInfo.ig_artist?.username || artist;
    } else {
      // Fallback: use the video MP4 file itself — mark as video fallback so
      // client downloads as .mp4 (not fake .mp3 which would be unplayable)
      const videoVersions = item.video_versions || item.video_resources || [];
      if (videoVersions.length > 0) {
        audioUrl = videoVersions[0].url || videoVersions[0].src;
        title = `Video (with Audio) from @${artist}`;
        isVideoFallback = true;
      }
    }

    if (!audioUrl) {
      return res.status(400).json({ error: 'Could not extract audio track from this post.' });
    }

    return res.json({
      success: true,
      shortcode,
      audioUrl,
      title,
      artist,
      artwork,
      isVideoFallback
    });


  } catch (err) {
    return res.status(400).json({ error: `Failed to fetch audio track: ${err.message}` });
  }
});

/* ==========================================================================
   STREAM PROXY ROUTE (SSRF Protected Attachment Downloads + Real MP3 Audio Conversion)
   ========================================================================== */
app.get('/api/download-stream', heavyApiLimiter, async (req, res) => {
  const { url, filename, type } = req.query;

  if (!url) return res.status(400).send('Missing media URL');

  // SSRF Protection: Domain & IP Whitelist Validation
  if (!isAllowedCdnDomain(url)) {
    return res.status(403).send('Forbidden: Target domain is not an authorized Instagram/Meta CDN server.');
  }

  // 1. REAL ON-THE-FLY MP3 CONVERSION (For Song / Audio Downloads)
  if (type === 'audio') {
    const rawName = filename ? String(filename).replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/\.[a-zA-Z0-9]+$/, '') : 'instaclipper_audio';
    const cleanFilename = `${rawName}.mp3`;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    try {
      const ffmpegBin = ffmpegStatic || 'ffmpeg';
      const ff = spawn(ffmpegBin, [
        '-loglevel', 'error',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        '-i', url,
        '-vn',
        '-acodec', 'libmp3lame',
        '-b:a', '192k',
        '-ar', '44100',
        '-f', 'mp3',
        'pipe:1'
      ]);

      req.on('close', () => {
        try { ff.kill('SIGKILL'); } catch (e) {}
      });

      ff.stdout.pipe(res);

      ff.on('error', async (err) => {
        console.error('[FFmpeg Audio Conversion Error]', err.message);
        if (!res.headersSent) {
          res.status(500).send(`Failed to extract audio track: ${err.message}`);
        }
      });

      return;
    } catch (ffmpegErr) {
      console.warn('[FFmpeg Fallback Warning]', ffmpegErr.message);
    }
  }

  // 2. VIDEO DOWNLOADS (Direct Stream Proxy with MP4 MIME)
  const cleanFilename = filename ? String(filename).replace(/[^a-zA-Z0-9_.-]/g, '_') : 'instaclipper_video.mp4';
  const mimeType = 'video/mp4';

  try {
    const streamRes = await axios.get(url, {
      responseType: 'stream',
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);

    // Memory leak fix: Destroy stream if client closes connection early
    req.on('close', () => {
      if (streamRes.data && typeof streamRes.data.destroy === 'function') {
        streamRes.data.destroy();
      }
    });

    streamRes.data.pipe(res);

  } catch (err) {
    res.status(500).send(`Failed to stream download: ${err.message}`);
  }
});


app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 InstaClipper Utility Suite App is running!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`🔒 Zero-Storage Mode: ACTIVE (No data stored on disk)`);
  console.log(`🛡️ SSRF Protection & Reverse Proxy Trust: ENABLED`);
  console.log(`====================================================`);
});
