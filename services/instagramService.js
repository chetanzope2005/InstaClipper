import axios from 'axios';

/**
 * Extracts Instagram shortcode from URL or returns clean shortcode
 */
export function parseShortcode(inputUrl) {
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
export function shortcodeToMediaId(shortcode) {
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

export function getCleanPostUrl(shortcode) {
  return `https://www.instagram.com/reel/${shortcode}/`;
}

export function getInstagramHeaders(sessionId) {
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

export class CookiePoolManager {
  constructor() {
    this.index = 0;
    this.failedCookies = new Map(); // cookie -> cooldown expiry timestamp
  }

  markFailed(cookie) {
    if (!cookie) return;
    const cooldownMs = 30 * 60 * 1000; // 30 minutes cooldown
    console.warn(`[CookiePool] Temporarily disabling dead/banned cookie for 30m: ${cookie.slice(0, 8)}...`);
    this.failedCookies.set(cookie, Date.now() + cooldownMs);
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

    const now = Date.now();
    // Filter out cookies that failed recently
    const active = list.filter(c => {
      const expiry = this.failedCookies.get(c);
      return !expiry || expiry <= now;
    });

    return active;
  }

  getNextSessionId() {
    const pool = this.getPool();
    if (pool.length === 0) return null;
    const selected = pool[this.index % pool.length];
    this.index = (this.index + 1) % pool.length;
    return selected;
  }
}

export const cookiePool = new CookiePoolManager();

/**
 * LAYER 1: Public Scraping (Zero Login Required)
 */
async function fetchMediaPublic(shortcode) {
  const errors = [];
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
      let videoUrl = '';
      
      const ogVideo = html.match(/property="og:video(?::secure_url)?"[^>]*content="([^"]+)"/i) ||
                      html.match(/content="([^"]+)"[^>]*property="og:video(?::secure_url)?"/i) ||
                      html.match(/property='og:video(?::secure_url)?'[^>]*content='([^']+)'/i);
      if (ogVideo) videoUrl = ogVideo[1].replace(/&amp;/g, '&');

      if (!videoUrl) {
        const jsonMatch = html.match(/"video_url"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/i);
        if (jsonMatch) videoUrl = jsonMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }

      if (!videoUrl) {
        const vvMatch = html.match(/"video_versions".*?"url"\s*:\s*"(https?:[^"]+)"/i);
        if (vvMatch) videoUrl = vvMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }

      let thumbnail = '';
      const ogImage = html.match(/property="og:image"[^>]*content="([^"]+)"/i) ||
                      html.match(/content="([^"]+)"[^>]*property="og:image"/i);
      if (ogImage) thumbnail = ogImage[1].replace(/&amp;/g, '&');

      let caption = '';
      const ogDesc = html.match(/property="og:description"[^>]*content="([^"]+)"/i) ||
                     html.match(/content="([^"]+)"[^>]*property="og:description"/i) ||
                     html.match(/property="og:title"[^>]*content="([^"]+)"/i);
      if (ogDesc) caption = ogDesc[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');

      const username = oembedData?.author_name || 'instagram_creator';

      if (videoUrl) {
        return {
          video_versions: [{ url: videoUrl, width: 1080, height: 1920 }],
          image_versions2: { candidates: [{ url: thumbnail }] },
          caption: { text: caption },
          user: { username }
        };
      }

      if (thumbnail && oembedData) {
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

  return null;
}

/**
 * Multi-layer Instagram Item Fetcher
 */
export async function fetchInstagramMediaItem(shortcode, mediaId, headers, effectiveSessionId) {
  const errors = [];

  // LAYER 1: Public Scraping
  try {
    const publicItem = await fetchMediaPublic(shortcode);
    if (publicItem && publicItem.video_versions && publicItem.video_versions.length > 0) {
      return publicItem;
    }
    if (publicItem) errors.push('public_layer: found but no video_versions');
  } catch (e0) {
    errors.push(`public_layer: ${e0.message}`);
  }

  // LAYER 2: /api/v1/media/{mediaId}/info/
  if (headers && headers.Cookie && mediaId && mediaId !== '0') {
    try {
      const infoUrl = `https://www.instagram.com/api/v1/media/${mediaId}/info/`;
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
        const redirectUrl = new URL(res1.headers.location, infoUrl);
        if (redirectUrl.protocol !== 'https:' ||
            !['instagram.com', 'www.instagram.com'].includes(redirectUrl.hostname.toLowerCase())) {
          throw new Error('Instagram returned an unsupported redirect.');
        }
        try {
          const res1b = await axios.get(redirectUrl.href, {
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
        cookiePool.markFailed(effectiveSessionId);
      }
      errors.push(`media_info: HTTP ${res1.status}`);
    } catch (e1) {
      errors.push(`media_info: ${e1.message}`);
    }
  }

  // LAYER 3: Modern GraphQL
  if (headers && headers.Cookie) {
    try {
      const docId = '8845758582119845';
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
      if (gqlRes.status === 401 || gqlRes.status === 403) {
        cookiePool.markFailed(effectiveSessionId);
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
      if (res2.status === 401 || res2.status === 403) {
        cookiePool.markFailed(effectiveSessionId);
      }
    } catch (e2) {
      errors.push(`by_url: ${e2.message}`);
    }
  }

  throw new Error(`Instagram fetch failed across all layers (${errors.join(' | ')})`);
}

/**
 * High-level Instagram Video Extractor
 */
export async function getInstagramVideo(postUrl) {
  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    throw new Error('Invalid Instagram Video or Reel URL.');
  }

  let mediaId = '0';
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    mediaId = '0';
  }

  const effectiveSessionId = cookiePool.getNextSessionId();
  const headers = effectiveSessionId ? getInstagramHeaders(effectiveSessionId) : {};

  const item = await fetchInstagramMediaItem(shortcode, mediaId, headers, effectiveSessionId);
  const videoVersions = item.video_versions || item.video_resources || [];

  if (!videoVersions || videoVersions.length === 0) {
    throw new Error('This Instagram post does not contain a playable video.');
  }

  const bestVideo = videoVersions[0];
  return {
    platform: 'instagram',
    shortcode,
    videoUrl: bestVideo.url || bestVideo.src,
    thumbnail: item.image_versions2?.candidates?.[0]?.url || item.display_url || '',
    caption: item.caption?.text || item.edge_media_to_caption?.edges?.[0]?.node?.text || '',
    username: item.user?.username || item.owner?.username || 'instagram_user',
    width: bestVideo.width || 1080,
    height: bestVideo.height || 1920
  };
}

/**
 * High-level Instagram Song / Audio Extractor
 */
export async function getInstagramAudio(postUrl) {
  const shortcode = parseShortcode(postUrl);
  if (!shortcode) {
    throw new Error('Invalid Instagram Reel/Audio URL.');
  }

  let mediaId = '0';
  try {
    mediaId = shortcodeToMediaId(shortcode);
  } catch (err) {
    mediaId = '0';
  }

  const effectiveSessionId = cookiePool.getNextSessionId();
  const headers = effectiveSessionId ? getInstagramHeaders(effectiveSessionId) : {};

  const item = await fetchInstagramMediaItem(shortcode, mediaId, headers, effectiveSessionId);

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
    const videoVersions = item.video_versions || item.video_resources || [];
    if (videoVersions.length > 0) {
      audioUrl = videoVersions[0].url || videoVersions[0].src;
      title = `Audio from @${artist}`;
      isVideoFallback = true;
    }
  }

  if (!audioUrl) {
    throw new Error('Could not extract audio track from this Instagram post.');
  }

  return {
    platform: 'instagram',
    shortcode,
    audioUrl,
    title,
    artist,
    artwork,
    isVideoFallback
  };
}
