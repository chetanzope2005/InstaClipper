import axios from 'axios';

const FACEBOOK_HOSTS = new Set([
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'fb.watch'
]);

/**
 * Validates and cleans Facebook Video or Reel URL
 */
export function isValidFacebookUrl(inputUrl) {
  if (!inputUrl) return false;
  try {
    const parsed = new URL(inputUrl.trim());
    if (parsed.protocol !== 'https:' || !FACEBOOK_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    return parsed.hostname.toLowerCase() === 'fb.watch'
      ? /^\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname)
      : /\/(?:reel|watch)(?:\/|$)|\/share\/[a-z]+\/[a-zA-Z0-9_-]+(?:\/|$)|\/(?:videos\/\d+|[^/]+\/videos\/\d+)(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&#x([\da-f]{1,6});?/gi, (_, code) => toSafeUnicode(parseInt(code, 16)))
    .replace(/&#(\d{1,7});?/g, (_, code) => toSafeUnicode(Number(code)))
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ');
}

function toSafeUnicode(codePoint) {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '\uFFFD';
}

async function fetchFacebookPage(inputUrl, headers) {
  let currentUrl = inputUrl;
  for (let hop = 0; hop <= 5; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'https:' || !FACEBOOK_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new Error('Facebook redirected to an unsupported address.');
    }
    const response = await axios.get(currentUrl, {
      headers, timeout: 10000, maxRedirects: 0, responseType: 'text',
      validateStatus: status => status >= 200 && status < 400
    });
    if (response.status < 300) return response;
    const location = response.headers.location;
    if (!location) throw new Error('Facebook returned an invalid redirect.');
    currentUrl = new URL(location, currentUrl).href;
  }
  throw new Error('Facebook redirected too many times.');
}

/**
 * Direct HTML Scraper Fallback for Facebook Videos and Reels
 */
async function scrapeFacebookDirect(targetUrl) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Mode': 'navigate'
  };

  const res = await fetchFacebookPage(targetUrl, headers);

  const html = decodeHtmlEntities(res.data || '');

  // Extract HD video URL
  let hdUrl = '';
  const hdMatch = html.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/i) ||
                  html.match(/"playable_url_quality_hd"\s*:\s*"([^"]+)"/i) ||
                  html.match(/"hd_src"\s*:\s*"([^"]+)"/i);
  if (hdMatch && hdMatch[1]) {
    hdUrl = hdMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
  }

  // Extract SD video URL
  let sdUrl = '';
  const sdMatch = html.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/i) ||
                  html.match(/"playable_url"\s*:\s*"([^"]+)"/i) ||
                  html.match(/"sd_src"\s*:\s*"([^"]+)"/i) ||
                  html.match(/property="og:video(?::secure_url)?"[^>]*content="([^"]+)"/i);
  if (sdMatch && sdMatch[1]) {
    sdUrl = sdMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
  }

  // Extract thumbnail
  let thumbnail = '';
  const thumbMatch = html.match(/"preferred_thumbnail"\s*:\s*\{"image"\s*:\s*\{"uri"\s*:\s*"([^"]+)"/i) ||
                     html.match(/property="og:image"[^>]*content="([^"]+)"/i);
  if (thumbMatch && thumbMatch[1]) {
    thumbnail = thumbMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
  }

  // Extract title / caption
  let title = 'Facebook Video';
  const titleMatch = html.match(/property="og:title"[^>]*content="([^"]+)"/i) ||
                     html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = decodeHtmlEntities(titleMatch[1]);
  }

  const captionMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
    html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  const caption = captionMatch?.[1] ? decodeHtmlEntities(captionMatch[1]) : '';

  const ownerMatch = html.match(/"(?:owner|video_owner|page)"\s*:\s*\{[^}]{0,1000}?"(?:name|username)"\s*:\s*"([^"\\]+)"/i) ||
    html.match(/<meta\s+name="author"\s+content="([^"]+)"/i);
  const creator = ownerMatch?.[2] || ownerMatch?.[1] || '';
  const username = creator ? decodeHtmlEntities(creator) : '';
  const durationMatch = html.match(/"playable_duration_in_ms"\s*:\s*(\d+)/i) ||
    html.match(/"duration_ms"\s*:\s*(\d+)/i);
  const durationSeconds = durationMatch ? Math.max(0, Math.round(Number(durationMatch[1]) / 1000)) : null;
  const widthMatch = html.match(/"(?:original_)?width"\s*:\s*(\d+)/i);
  const heightMatch = html.match(/"(?:original_)?height"\s*:\s*(\d+)/i);
  const width = widthMatch ? Number(widthMatch[1]) : null;
  const height = heightMatch ? Number(heightMatch[1]) : null;

  const finalVideoUrl = hdUrl || sdUrl;
  if (!finalVideoUrl) {
    throw new Error('Could not find public video stream in Facebook page HTML.');
  }

  return {
    hd: hdUrl,
    sd: sdUrl || hdUrl,
    videoUrl: finalVideoUrl,
    title,
    username,
    caption,
    thumbnail,
    durationSeconds,
    width,
    height,
    quality: width && height ? `${width}×${height}` : (hdUrl ? 'HD available' : 'SD available')
  };
}

/**
 * Extracts Facebook Video details
 */
export async function getFacebookVideo(postUrl) {
  if (!isValidFacebookUrl(postUrl)) {
    throw new Error('Please enter a valid Facebook Reel or Video link.');
  }

  const cleanUrl = postUrl.trim();
  const errors = [];

  // Fetch only verified Facebook addresses and validate each redirect.
  try {
    const directData = await scrapeFacebookDirect(cleanUrl);
    return {
      platform: 'facebook',
      videoUrl: directData.videoUrl,
      hdUrl: directData.hd || null,
      sdUrl: directData.sd || null,
      title: directData.title,
      caption: directData.caption,
      thumbnail: directData.thumbnail,
      username: directData.username,
      quality: directData.quality,
      durationMs: directData.durationSeconds ? directData.durationSeconds * 1000 : null,
      durationSeconds: directData.durationSeconds,
      width: directData.width,
      height: directData.height
    };
  } catch (err) {
    errors.push(`direct: ${err.message}`);
  }

  throw new Error(`Failed to extract Facebook video (${errors.join(' | ')})`);
}

/**
 * Extracts Facebook Audio track (uses best video stream for FFmpeg MP3 conversion)
 */
export async function getFacebookAudio(postUrl) {
  const videoData = await getFacebookVideo(postUrl);
  return {
    platform: 'facebook',
    audioUrl: videoData.hdUrl || videoData.sdUrl || videoData.videoUrl,
    title: videoData.title || 'Facebook Audio Track',
    artist: videoData.username || 'Facebook Creator',
    artwork: videoData.thumbnail || '',
    isVideoFallback: true
  };
}
