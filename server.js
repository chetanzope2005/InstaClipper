import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable Reverse Proxy Trust (Required for Render, Vercel, Cloudflare, Nginx)
app.set('trust proxy', 1);

// Security Response Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  const cleanSessionId = sessionId ? sessionId.trim().replace(/^sessionid=/, '') : '';
  const match = cleanSessionId.match(/^(\d+)(?:%3A|:)/);
  const dsUserId = match ? match[1] : '';

  let cookieHeader = `sessionid=${cleanSessionId};`;
  if (dsUserId) {
    cookieHeader += ` ds_user_id=${dsUserId};`;
  }

  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'X-IG-App-ID': '936619743392459',
    'Cookie': cookieHeader,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'X-Requested-With': 'XMLHttpRequest'
  };
}

/**
 * LAYER 4: HTML Meta Scraper (Public Bot User-Agent)
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
 */
async function fetchInstagramMediaItem(shortcode, mediaId, headers) {
  const cleanUrl = getCleanPostUrl(shortcode);
  const errors = [];

  // Layer 1: /api/v1/media/{mediaId}/info/
  try {
    const infoUrl = `https://www.instagram.com/api/v1/media/${mediaId}/info/`;
    const res1 = await axios.get(infoUrl, {
      headers,
      timeout: 9000,
      maxRedirects: 0,
      validateStatus: s => s === 200
    });
    if (res1.data?.items?.[0]) {
      return res1.data.items[0];
    }
  } catch (e1) {
    errors.push(`media_info: ${e1.message}`);
  }

  // Layer 2: /api/v1/media/by_url/
  try {
    const byUrlEndpoint = `https://www.instagram.com/api/v1/media/by_url/?url=${encodeURIComponent(cleanUrl)}`;
    const res2 = await axios.get(byUrlEndpoint, {
      headers,
      timeout: 9000,
      maxRedirects: 0,
      validateStatus: s => s === 200
    });
    if (res2.data?.items?.[0]) {
      return res2.data.items[0];
    }
  } catch (e2) {
    errors.push(`by_url: ${e2.message}`);
  }

  // Layer 3: GraphQL Query Hash
  try {
    const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=b5a47637841c816503c2069695d705c7&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
    const res3 = await axios.get(gqlUrl, {
      headers,
      timeout: 9000,
      maxRedirects: 0,
      validateStatus: s => s === 200
    });
    if (res3.data?.data?.shortcode_media) {
      const media = res3.data.data.shortcode_media;
      return {
        video_versions: media.video_url ? [{ url: media.video_url, width: 1080, height: 1920 }] : [],
        image_versions2: { candidates: [{ url: media.display_url }] },
        caption: { text: media.edge_media_to_caption?.edges?.[0]?.node?.text || '' },
        user: { username: media.owner?.username || 'user' }
      };
    }
  } catch (e3) {
    errors.push(`graphql: ${e3.message}`);
  }

  // Layer 4: HTML Meta Scraper Fallback
  try {
    const htmlResult = await fetchMediaFromHtml(shortcode);
    return {
      video_versions: [{ url: htmlResult.videoUrl, width: htmlResult.width, height: htmlResult.height }],
      image_versions2: { candidates: [{ url: htmlResult.thumbnail }] },
      caption: { text: htmlResult.caption },
      user: { username: htmlResult.username }
    };
  } catch (e4) {
    errors.push(`html_scraper: ${e4.message}`);
  }

  throw new Error(`Media fetch failed across all 4 layers (${errors.join(' | ')})`);
}

/* ==========================================================================
   FEATURE 1: INSTAGRAM COMMENT & REPLIES SCRAPER API
   ========================================================================== */
app.post('/api/scrape-comments', heavyApiLimiter, async (req, res) => {
  const { postUrl, sessionId } = req.body;

  if (!postUrl || !sessionId) {
    return res.status(400).json({ error: 'Post URL and Session ID are required.' });
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

  const headers = getInstagramHeaders(sessionId);
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

      const response = await axios.get(url, { headers, timeout: 15000, maxRedirects: 0, validateStatus: s => s < 500 });

      if (response.status === 401 || response.status === 403) {
        return res.status(401).json({ error: 'Session ID is invalid or expired.' });
      }

      if (response.status === 404) {
        return res.status(404).json({ error: 'Post not found or is private.' });
      }

      if (response.status === 429) {
        return res.status(429).json({ error: 'Instagram rate limit reached. Please wait a few minutes.' });
      }

      const data = response.data;
      if (!data || data.status !== 'ok') {
        if (commentsList.length > 0) break;
        return res.status(400).json({ error: data?.message || 'Failed to fetch comments.' });
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
  const { postUrl, sessionId } = req.query;

  if (!postUrl || !sessionId) {
    return res.status(400).json({ error: 'Post URL and Session ID are required.' });
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
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  const headers = getInstagramHeaders(sessionId);
  let minId = '';
  let maxId = '';
  let hasMore = true;
  let pageCount = 0;
  const maxPages = 300;
  let totalCommentsSent = 0;

  try {
    while (hasMore && pageCount < maxPages) {
      pageCount++;
      let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true`;
      if (minId) {
        url += `&min_id=${encodeURIComponent(minId)}`;
      } else if (maxId) {
        url += `&max_id=${encodeURIComponent(maxId)}`;
      }

      const response = await axios.get(url, { headers, timeout: 12000, maxRedirects: 0, validateStatus: s => s < 500 });

      if (response.status === 401 || response.status === 403) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Session ID is invalid or expired.' })}\n\n`);
        return res.end();
      }

      if (response.status === 404) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Post not found or is private.' })}\n\n`);
        return res.end();
      }

      const data = response.data;
      if (!data || data.status !== 'ok') {
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

      let instagramTotalCount = data.comment_count || 0;

      // Send live batch to client
      res.write(`data: ${JSON.stringify({ type: 'batch', comments: pageComments, shortcode, mediaId, totalCommentsSent, instagramTotalCount })}\n\n`);

      minId = data.next_min_id || data.next_max_id || '';
      maxId = data.next_max_id || '';
      hasMore = Boolean(data.has_more_comments || data.has_more_headload_comments) && Boolean(minId || maxId);

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', totalCommentsSent })}\n\n`);
    res.end();

  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'done', warning: err.message, totalCommentsSent })}\n\n`);
    res.end();
  }
});

/* ==========================================================================
   FEATURE 2: INSTAGRAM VIDEO DOWNLOADER API
   ========================================================================== */
app.post('/api/fetch-video-info', heavyApiLimiter, async (req, res) => {
  const { postUrl, sessionId } = req.body;

  if (!postUrl || !sessionId) {
    return res.status(400).json({ error: 'Post URL and Session ID are required.' });
  }

  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    return res.status(400).json({ error: 'Invalid Instagram Video/Reel URL.' });
  }

  let mediaId;
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    mediaId = '0';
  }

  const headers = getInstagramHeaders(sessionId);

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

  if (!postUrl || !sessionId) {
    return res.status(400).json({ error: 'Post URL and Session ID are required.' });
  }

  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    return res.status(400).json({ error: 'Invalid Instagram Reel/Audio URL.' });
  }

  let mediaId;
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    mediaId = '0';
  }

  const headers = getInstagramHeaders(sessionId);

  try {
    const item = await fetchInstagramMediaItem(shortcode, mediaId, headers);

    let audioUrl = '';
    let title = 'Original Audio';
    let artist = item.user?.username || item.owner?.username || 'Instagram Artist';
    let artwork = item.image_versions2?.candidates?.[0]?.url || item.display_url || '';

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
      const videoVersions = item.video_versions || item.video_resources || [];
      if (videoVersions.length > 0) {
        audioUrl = videoVersions[0].url || videoVersions[0].src;
        title = `Audio from @${artist}`;
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
      artwork
    });

  } catch (err) {
    return res.status(400).json({ error: `Failed to fetch audio track: ${err.message}` });
  }
});

/* ==========================================================================
   STREAM PROXY ROUTE (SSRF Protected Attachment Downloads)
   ========================================================================== */
app.get('/api/download-stream', heavyApiLimiter, async (req, res) => {
  const { url, filename, type } = req.query;

  if (!url) return res.status(400).send('Missing media URL');

  // SSRF Protection: Domain & IP Whitelist Validation
  if (!isAllowedCdnDomain(url)) {
    return res.status(403).send('Forbidden: Target domain is not an authorized Instagram/Meta CDN server.');
  }

  const cleanFilename = filename ? String(filename).replace(/[^a-zA-Z0-9_.-]/g, '_') : 'instaclipper_media';
  const mimeType = type === 'audio' ? 'audio/mpeg' : 'video/mp4';

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
