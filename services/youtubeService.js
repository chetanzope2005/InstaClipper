import { Ytdl, parseVideoId } from '@distube/ytdl-core';

const ytdl = new Ytdl();

/**
 * Extracts YouTube Video ID from any standard or short URL
 */
export function extractYoutubeId(inputUrl) {
  if (!inputUrl) return null;
  const clean = inputUrl.trim();
  
  // Standard parseVideoId from ytdl-core
  try {
    const id = parseVideoId(clean);
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return id;
    }
  } catch (e) {}

  // Direct regex matches
  const patterns = [
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i,
    /^[a-zA-Z0-9_-]{11}$/
  ];

  for (const regex of patterns) {
    const match = clean.match(regex);
    if (match && match[1]) return match[1];
    if (match && match[0] && match[0].length === 11) return match[0];
  }

  return null;
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
  const s = parseInt(seconds, 10) || 0;
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * Extracts YouTube Video Info
 */
export async function getYoutubeVideo(videoUrl) {
  const videoId = extractYoutubeId(videoUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube URL or Shorts link. Please check the URL.');
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  try {
    const info = await ytdl.getInfo(cleanUrl);
    const details = info.videoDetails || {};

    // Find best format with both audio and video if available
    const combinedFormats = (info.formats || []).filter(f => f.hasVideo && f.hasAudio && f.url);
    const videoOnlyFormats = (info.formats || []).filter(f => f.hasVideo && f.url);
    
    // Choose best candidate: prefer format with both video AND audio
    const hasCombined = combinedFormats.length > 0;
    let bestFormat = hasCombined ? combinedFormats[0] : videoOnlyFormats[0];

    // Pick highest resolution thumbnail
    const thumbnails = details.thumbnails || [];
    const bestThumb = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : '';

    const title = details.title || 'YouTube Video';
    const author = details.author?.name || details.author?.user || 'YouTube Creator';
    const duration = formatDuration(details.lengthSeconds);
    const qualityLabel = bestFormat?.qualityLabel || (hasCombined ? 'Standard 360p' : 'Video Stream');

    return {
      platform: 'youtube',
      videoId,
      videoUrl: bestFormat?.url || '',
      title,
      username: author,
      thumbnail: bestThumb,
      duration,
      quality: hasCombined ? qualityLabel : `${qualityLabel} (Video Only)`,
      hasAudio: Boolean(bestFormat?.hasAudio),
      mimeType: bestFormat?.mimeType || 'video/mp4',
      caption: details.description ? details.description.slice(0, 200) + '...' : '',
      formats: (info.formats || [])
        .filter(f => f.url && (f.hasVideo || f.hasAudio))
        .map(f => ({
          itag: f.itag,
          quality: f.qualityLabel || (f.hasAudio && !f.hasVideo ? `${f.audioBitrate || 128}kbps Audio` : 'Default'),
          mimeType: f.mimeType,
          hasAudio: f.hasAudio,
          hasVideo: f.hasVideo,
          url: f.url
        }))
    };
  } catch (err) {
    const msg = String(err.message || '');
    if (msg.includes('confirm you') || msg.includes('bot') || msg.includes('429')) {
      throw new Error('YouTube bot-check triggered by hosting IP. Please try again later; audio extraction may be affected too.');
    }
    throw new Error(`YouTube video extraction error: ${err.message}`);
  }
}

/**
 * Extracts YouTube Audio (for MP3 conversion)
 */
export async function getYoutubeAudio(videoUrl) {
  const videoId = extractYoutubeId(videoUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube URL or Shorts link.');
  }

  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const info = await ytdl.getInfo(cleanUrl);
    const details = info.videoDetails || {};

    // Select audio-only format with highest bitrate
    const audioFormats = (info.formats || [])
      .filter(f => f.hasAudio && f.url)
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

    if (audioFormats.length === 0) {
      throw new Error('No audio streams found for this YouTube video.');
    }

    const bestAudio = audioFormats[0];
    const thumbnails = details.thumbnails || [];
    const bestThumb = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : '';

    return {
      platform: 'youtube',
      videoId,
      audioUrl: bestAudio.url,
      title: details.title || 'YouTube Audio Track',
      artist: details.author?.name || 'YouTube Music',
      artwork: bestThumb,
      duration: formatDuration(details.lengthSeconds),
      bitrate: bestAudio.audioBitrate || 192
    };
  } catch (err) {
    throw new Error(`YouTube audio extraction error: ${err.message}`);
  }
}
