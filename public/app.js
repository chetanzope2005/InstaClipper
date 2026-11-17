/**
 * MEDIACLIPPER SUITE - FRONTEND SPA APPLICATION LOGIC
 * Features: Multi-Platform (Instagram, YouTube, Facebook),
 * Zero-Storage Streaming, Left Slide Drawer, Interstitial Ads, Modals
 */

document.addEventListener('DOMContentLoaded', () => {
  // SPA Panels & Navigation
  const viewPanels = document.querySelectorAll('.view-panel');
  const drawer = document.getElementById('app-drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  const btnOpenDrawer = document.getElementById('btn-open-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  const brandLogoBtn = document.getElementById('brand-logo-btn');

  // Legal Modal Elements
  const legalModal = document.getElementById('legal-modal');
  const legalModalTitle = document.getElementById('legal-modal-title');
  const btnCloseLegalModal = document.getElementById('btn-close-legal-modal');
  const btnOpenLegalTerms = document.getElementById('btn-open-legal-terms');
  const btnOpenLegalDmca = document.getElementById('btn-open-legal-dmca');
  const btnOpenLegalFairuse = document.getElementById('btn-open-legal-fairuse');
  const legalTabBtns = document.querySelectorAll('.legal-tab-btn');
  const legalTabContents = document.querySelectorAll('.legal-tab-content');

  // Clipboard Paste Buttons
  const pasteBtns = document.querySelectorAll('.btn-paste-input');

  /* ==========================================================================
     SPA ROUTER & SLIDE DRAWER
     ========================================================================== */
  function navigateTo(targetViewId) {
    viewPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === targetViewId);
    });

    document.querySelectorAll('.drawer-link').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-target') === targetViewId);
    });

    closeDrawer();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (brandLogoBtn) {
    brandLogoBtn.addEventListener('click', () => navigateTo('view-home'));
  }

  // Cards on dashboard
  document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('click', () => {
      const target = card.getAttribute('data-target');
      if (target) navigateTo(target);
    });
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        card.click();
      }
    });
  });

  // Drawer links
  document.querySelectorAll('.drawer-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target) navigateTo(target);
    });
  });

  // "Back to All Platforms" buttons inside modules
  document.querySelectorAll('.btn-back-hub').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo('view-home');
    });
  });

  if (btnOpenDrawer) btnOpenDrawer.addEventListener('click', openDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

  function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.remove('hidden');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.add('hidden');
  }

  // Paste from clipboard helper
  pasteBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const input = btn.parentElement.querySelector('input');
      if (!input) return;
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          input.value = text.trim();
          input.focus();
        }
      } catch (err) {
        alert('Clipboard permission not granted. Please paste manually.');
      }
    });
  });

  /* ==========================================================================
     INTERSTITIAL AD MODAL FOR DOWNLOADS (Zero-Storage Safe Downloads)
     ========================================================================== */
  const downloadAdModal = document.getElementById('download-ad-modal');
  const adCountdownSec = document.getElementById('ad-countdown-sec');
  const btnCloseDownloadAd = document.getElementById('btn-close-download-ad');
  const btnSkipDownloadAd = document.getElementById('btn-skip-download-ad');
  const skipBtnLabel = document.getElementById('skip-btn-label');

  let pendingDownloadAction = null;
  let adTimerInterval = null;
  let isSkipEnabled = false;

  function triggerDownloadWithAd(actionCallback) {
    pendingDownloadAction = actionCallback;
    let waitSeconds = 4;
    let autoCloseSeconds = 4;
    isSkipEnabled = false;

    if (adCountdownSec) adCountdownSec.textContent = autoCloseSeconds;
    if (skipBtnLabel) skipBtnLabel.textContent = `Downloading in ${waitSeconds}s...`;
    if (btnSkipDownloadAd) btnSkipDownloadAd.disabled = true;
    if (btnCloseDownloadAd) btnCloseDownloadAd.classList.add('hidden');

    if (downloadAdModal) downloadAdModal.classList.remove('hidden');

    if (adTimerInterval) clearInterval(adTimerInterval);

    adTimerInterval = setInterval(() => {
      waitSeconds--;
      autoCloseSeconds--;

      if (adCountdownSec) adCountdownSec.textContent = Math.max(0, autoCloseSeconds);

      if (waitSeconds > 0) {
        if (skipBtnLabel) skipBtnLabel.textContent = `Downloading in ${waitSeconds}s...`;
      } else if (!isSkipEnabled) {
        isSkipEnabled = true;
        if (btnSkipDownloadAd) btnSkipDownloadAd.disabled = false;
        if (skipBtnLabel) skipBtnLabel.textContent = `Download File Now ⚡`;
        if (btnCloseDownloadAd) btnCloseDownloadAd.classList.remove('hidden');
      }

      if (autoCloseSeconds <= 0) {
        finishAndExecuteDownload();
      }
    }, 1000);
  }

  function finishAndExecuteDownload() {
    if (adTimerInterval) {
      clearInterval(adTimerInterval);
      adTimerInterval = null;
    }
    if (downloadAdModal) downloadAdModal.classList.add('hidden');

    if (pendingDownloadAction) {
      const action = pendingDownloadAction;
      pendingDownloadAction = null;
      action();
    }
  }

  if (btnCloseDownloadAd) {
    btnCloseDownloadAd.addEventListener('click', () => {
      if (isSkipEnabled) finishAndExecuteDownload();
    });
  }

  if (btnSkipDownloadAd) {
    btnSkipDownloadAd.addEventListener('click', () => {
      if (isSkipEnabled) finishAndExecuteDownload();
    });
  }

  if (downloadAdModal) {
    downloadAdModal.addEventListener('click', (e) => {
      if (e.target === downloadAdModal && isSkipEnabled) {
        finishAndExecuteDownload();
      }
    });
  }

  function registerDownloadClick(element) {
    if (!element) return;
    element.addEventListener('click', (e) => {
      e.preventDefault();
      const href = element.getAttribute('href');
      if (!href || href === '#' || href.endsWith('#')) return;
      triggerDownloadWithAd(() => {
        const downloadUrl = new URL(href, window.location.href);
        downloadUrl.searchParams.set('downloadTarget', 'frame');
        downloadFrame.src = downloadUrl.toString();
      });
    });
  }

  const downloadFrame = document.createElement('iframe');
  downloadFrame.name = 'mediaclipper-download';
  downloadFrame.title = 'Download status';
  downloadFrame.hidden = true;
  document.body.appendChild(downloadFrame);

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin || event.source !== downloadFrame.contentWindow) return;
    if (!event.data || event.data.type !== 'download-error') return;
    window.alert(event.data.message);
  });

  /* ==========================================================================
     MODULE 1: INSTAGRAM HANDLERS
     ========================================================================== */
  const tabBtnIgVideo = document.getElementById('tab-btn-ig-video');
  const tabBtnIgSong = document.getElementById('tab-btn-ig-song');
  const igPanelVideo = document.getElementById('ig-panel-video');
  const igPanelSong = document.getElementById('ig-panel-song');

  if (tabBtnIgVideo && tabBtnIgSong) {
    tabBtnIgVideo.addEventListener('click', () => {
      tabBtnIgVideo.classList.add('active');
      tabBtnIgSong.classList.remove('active');
      igPanelVideo.classList.remove('hidden');
      igPanelSong.classList.add('hidden');
    });

    tabBtnIgSong.addEventListener('click', () => {
      tabBtnIgSong.classList.add('active');
      tabBtnIgVideo.classList.remove('active');
      igPanelSong.classList.remove('hidden');
      igPanelVideo.classList.add('hidden');
    });
  }

  function sanitizeTitleForFilename(rawTitle, fallback) {
    if (!rawTitle || typeof rawTitle !== 'string') return fallback;
    const cleaned = rawTitle
      .replace(/<[^>]+>/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\/\\:*?"<>|]/g, '')
      .trim()
      .slice(0, 90)
      .trim();
    return cleaned || fallback;
  }

  // Feature 1A: Instagram Video Downloader
  const videoForm = document.getElementById('video-form');
  const videoUrlInput = document.getElementById('video-url');
  const btnSubmitVideo = document.getElementById('btn-submit-video');
  const spinnerVideo = document.getElementById('spinner-video');
  const errorCardVideo = document.getElementById('error-card-video');
  const errorMsgVideo = document.getElementById('error-msg-video');
  const resultsVideo = document.getElementById('results-video');
  const videoPlayer = document.getElementById('video-player');
  const videoUsername = document.getElementById('video-username');
  const videoResolution = document.getElementById('video-resolution');
  const videoCaption = document.getElementById('video-caption');
  const btnDownloadMp4 = document.getElementById('btn-download-mp4');

  if (videoForm) {
    videoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const postUrl = videoUrlInput.value.trim();
      if (!postUrl) return;

      errorCardVideo.classList.add('hidden');
      resultsVideo.classList.add('hidden');
      btnSubmitVideo.disabled = true;
      spinnerVideo.classList.remove('hidden');

      try {
        const response = await fetch('/api/instagram/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postUrl })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch Instagram video.');
        }

        const titleBase = data.caption
          ? sanitizeTitleForFilename(data.caption, `instagram_${data.shortcode}`)
          : `instagram_${data.username || 'video'}_${data.shortcode}`;
        const filename = `${titleBase}.mp4`;
        const streamUrl = `/api/download-stream?url=${encodeURIComponent(data.videoUrl)}&filename=${encodeURIComponent(filename)}&type=video`;

        videoPlayer.src = data.videoUrl;
        if (data.thumbnail) videoPlayer.poster = data.thumbnail;
        videoUsername.textContent = `@${data.username}`;
        videoResolution.textContent = `HD ${data.width}x${data.height}`;
        videoCaption.textContent = data.caption || 'No caption available.';

        btnDownloadMp4.href = streamUrl;

        resultsVideo.classList.remove('hidden');
        resultsVideo.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        errorMsgVideo.textContent = err.message;
        errorCardVideo.classList.remove('hidden');
      } finally {
        btnSubmitVideo.disabled = false;
        spinnerVideo.classList.add('hidden');
      }
    });
  }

  // Feature 1B: Instagram Song Downloader
  const songForm = document.getElementById('song-form');
  const songUrlInput = document.getElementById('song-url');
  const btnSubmitSong = document.getElementById('btn-submit-song');
  const spinnerSong = document.getElementById('spinner-song');
  const errorCardSong = document.getElementById('error-card-song');
  const errorMsgSong = document.getElementById('error-msg-song');
  const resultsSong = document.getElementById('results-song');
  const songArtwork = document.getElementById('song-artwork');
  const songTitle = document.getElementById('song-title');
  const songArtist = document.getElementById('song-artist');
  const audioPlayer = document.getElementById('audio-player');
  const btnDownloadMp3 = document.getElementById('btn-download-mp3');

  if (songForm) {
    songForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const postUrl = songUrlInput.value.trim();
      if (!postUrl) return;

      errorCardSong.classList.add('hidden');
      resultsSong.classList.add('hidden');
      btnSubmitSong.disabled = true;
      spinnerSong.classList.remove('hidden');

      try {
        const response = await fetch('/api/instagram/song', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postUrl })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch Instagram audio.');
        }

        const songName = `${data.title || 'Audio'} - ${data.artist || 'Instagram'}`;
        const filename = `${sanitizeTitleForFilename(songName, `instagram_audio_${data.shortcode}`)}.mp3`;
        const audioStreamUrl = `/api/download-stream?url=${encodeURIComponent(data.audioUrl)}&filename=${encodeURIComponent(filename)}&type=audio`;

        audioPlayer.src = data.audioUrl;
        songTitle.textContent = data.title || 'Original Audio';
        songArtist.textContent = `@${data.artist}`;
        songArtwork.src = data.artwork || 'logo.png';

        btnDownloadMp3.textContent = '⬇ Download Audio Track (MP3)';
        btnDownloadMp3.href = audioStreamUrl;

        resultsSong.classList.remove('hidden');
        resultsSong.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        errorMsgSong.textContent = err.message;
        errorCardSong.classList.remove('hidden');
      } finally {
        btnSubmitSong.disabled = false;
        spinnerSong.classList.add('hidden');
      }
    });
  }

  registerDownloadClick(btnDownloadMp4);
  registerDownloadClick(btnDownloadMp3);

  /* ==========================================================================
     MODULE 2: YOUTUBE HANDLERS (Isolated Fault-Tolerant)
     ========================================================================== */
  const youtubeForm = document.getElementById('youtube-form');
  const ytUrlInput = document.getElementById('yt-url');
  const btnSubmitYt = document.getElementById('btn-submit-yt');
  const spinnerYt = document.getElementById('spinner-yt');
  const errorCardYt = document.getElementById('error-card-yt');
  const errorMsgYt = document.getElementById('error-msg-yt');
  const resultsYt = document.getElementById('results-yt');
  const ytThumbnail = document.getElementById('yt-thumbnail');
  const ytDuration = document.getElementById('yt-duration');
  const ytAuthor = document.getElementById('yt-author');
  const ytQuality = document.getElementById('yt-quality');
  const ytTitle = document.getElementById('yt-title');
  const ytCaption = document.getElementById('yt-caption');
  const btnDownloadYtVideo = document.getElementById('btn-download-yt-video');
  const btnDownloadYtAudio = document.getElementById('btn-download-yt-audio');

  if (youtubeForm) {
    youtubeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const videoUrl = ytUrlInput.value.trim();
      if (!videoUrl) return;

      errorCardYt.classList.add('hidden');
      resultsYt.classList.add('hidden');
      btnSubmitYt.disabled = true;
      spinnerYt.classList.remove('hidden');

      try {
        const response = await fetch('/api/youtube/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch YouTube video details.');
        }

        ytThumbnail.src = data.thumbnail || 'logo.png';
        ytDuration.textContent = data.duration || 'Video';
        ytAuthor.textContent = data.username || 'YouTube Creator';
        ytQuality.textContent = data.quality || 'HD';
        ytTitle.textContent = data.title || 'YouTube Video';
        ytCaption.textContent = data.caption || '';

        // Title-based Video Download URL
        if (data.videoUrl) {
          const videoTitle = sanitizeTitleForFilename(data.title, `youtube_${data.videoId || 'video'}`);
          const videoName = `${videoTitle}.mp4`;
          btnDownloadYtVideo.href = `/api/download-stream?url=${encodeURIComponent(data.videoUrl)}&filename=${encodeURIComponent(videoName)}&type=video`;
          btnDownloadYtVideo.classList.remove('hidden');
        } else {
          btnDownloadYtVideo.classList.add('hidden');
        }

        // Title-based Audio Stream URL
        try {
          const audioRes = await fetch('/api/youtube/song', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl })
          });
          const audioData = await audioRes.json();
          if (audioData.success && audioData.audioUrl) {
            const rawAudioTitle = audioData.title || data.title || 'YouTube Audio';
            const audioArtist = audioData.artist || data.username || '';
            const fullAudioTitle = audioArtist && !rawAudioTitle.includes(audioArtist)
              ? `${rawAudioTitle} - ${audioArtist}`
              : rawAudioTitle;
            const audioName = `${sanitizeTitleForFilename(fullAudioTitle, `youtube_audio_${data.videoId || 'audio'}`)}.mp3`;
            btnDownloadYtAudio.href = `/api/download-stream?url=${encodeURIComponent(audioData.audioUrl)}&filename=${encodeURIComponent(audioName)}&type=audio`;
            btnDownloadYtAudio.classList.remove('hidden');
          }
        } catch (audioErr) {
          console.warn('[YouTube Audio Link Error]', audioErr.message);
        }

        resultsYt.classList.remove('hidden');
        resultsYt.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        errorMsgYt.textContent = err.message;
        errorCardYt.classList.remove('hidden');
      } finally {
        btnSubmitYt.disabled = false;
        spinnerYt.classList.add('hidden');
      }
    });
  }

  registerDownloadClick(btnDownloadYtVideo);
  registerDownloadClick(btnDownloadYtAudio);

  /* ==========================================================================
     MODULE 3: FACEBOOK HANDLERS (Isolated Fault-Tolerant)
     ========================================================================== */
  const facebookForm = document.getElementById('facebook-form');
  const fbUrlInput = document.getElementById('fb-url');
  const btnSubmitFb = document.getElementById('btn-submit-fb');
  const spinnerFb = document.getElementById('spinner-fb');
  const errorCardFb = document.getElementById('error-card-fb');
  const errorMsgFb = document.getElementById('error-msg-fb');
  const resultsFb = document.getElementById('results-fb');
  const fbPlayer = document.getElementById('fb-player');
  const fbUsername = document.getElementById('fb-username');
  const fbResolution = document.getElementById('fb-resolution');
  const fbTitle = document.getElementById('fb-title');
  const btnDownloadFbHd = document.getElementById('btn-download-fb-hd');
  const btnDownloadFbSd = document.getElementById('btn-download-fb-sd');
  const btnDownloadFbAudio = document.getElementById('btn-download-fb-audio');

  if (facebookForm) {
    facebookForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const postUrl = fbUrlInput.value.trim();
      if (!postUrl) return;

      errorCardFb.classList.add('hidden');
      resultsFb.classList.add('hidden');
      btnSubmitFb.disabled = true;
      spinnerFb.classList.remove('hidden');

      try {
        const response = await fetch('/api/facebook/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postUrl })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch Facebook video.');
        }

        fbPlayer.src = data.hdUrl || data.sdUrl || data.videoUrl;
        if (data.thumbnail) fbPlayer.poster = data.thumbnail;
        fbUsername.textContent = `@${data.username || 'facebook'}`;
        fbResolution.textContent = data.quality || 'HD 1080p';
        fbTitle.textContent = data.title || 'Facebook Video';

        const titleBase = sanitizeTitleForFilename(data.title, 'facebook_video');

        // HD Download Link with Title
        const hdTarget = data.hdUrl || data.videoUrl;
        if (hdTarget) {
          const hdName = `${titleBase} (HD).mp4`;
          btnDownloadFbHd.href = `/api/download-stream?url=${encodeURIComponent(hdTarget)}&filename=${encodeURIComponent(hdName)}&type=video`;
          btnDownloadFbHd.classList.remove('hidden');
        }

        // SD Download Link with Title
        if (data.sdUrl && data.sdUrl !== data.hdUrl) {
          const sdName = `${titleBase} (SD).mp4`;
          btnDownloadFbSd.href = `/api/download-stream?url=${encodeURIComponent(data.sdUrl)}&filename=${encodeURIComponent(sdName)}&type=video`;
          btnDownloadFbSd.classList.remove('hidden');
        } else {
          btnDownloadFbSd.classList.add('hidden');
        }

        // MP3 Audio Conversion Link with Title
        const audioSource = data.hdUrl || data.sdUrl || data.videoUrl;
        const audioName = `${titleBase}.mp3`;
        btnDownloadFbAudio.href = `/api/download-stream?url=${encodeURIComponent(audioSource)}&filename=${encodeURIComponent(audioName)}&type=audio`;

        resultsFb.classList.remove('hidden');
        resultsFb.scrollIntoView({ behavior: 'smooth' });

      } catch (err) {
        errorMsgFb.textContent = err.message;
        errorCardFb.classList.remove('hidden');
      } finally {
        btnSubmitFb.disabled = false;
        spinnerFb.classList.add('hidden');
      }
    });
  }

  registerDownloadClick(btnDownloadFbHd);
  registerDownloadClick(btnDownloadFbSd);
  registerDownloadClick(btnDownloadFbAudio);

  /* ==========================================================================
     LEGAL MODAL HANDLERS
     ========================================================================== */
  if (btnOpenLegalTerms) btnOpenLegalTerms.addEventListener('click', () => openLegalModal('legal-tab-storage'));
  if (btnOpenLegalDmca) btnOpenLegalDmca.addEventListener('click', () => openLegalModal('legal-tab-dmca'));
  if (btnOpenLegalFairuse) btnOpenLegalFairuse.addEventListener('click', () => openLegalModal('legal-tab-fairuse'));
  if (btnCloseLegalModal) btnCloseLegalModal.addEventListener('click', closeLegalModal);

  if (legalModal) {
    legalModal.addEventListener('click', (e) => {
      if (e.target === legalModal) closeLegalModal();
    });
  }

  function openLegalModal(defaultTabId) {
    if (legalModal) {
      legalModal.classList.remove('hidden');
      switchLegalTab(defaultTabId);
      if (legalModalTitle) {
        const titles = {
          'legal-tab-dmca': 'DMCA & Takedown',
          'legal-tab-storage': 'Zero-Storage Privacy Terms',
          'legal-tab-fairuse': 'Terms of Use & Fair Use'
        };
        legalModalTitle.textContent = titles[defaultTabId] || 'Legal Terms & Compliance';
      }
    }
  }

  function closeLegalModal() {
    if (legalModal) legalModal.classList.add('hidden');
  }

  legalTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchLegalTab(tabId);
    });
  });

  function switchLegalTab(tabId) {
    legalTabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
    legalTabContents.forEach(c => c.classList.toggle('active', c.id === tabId));
  }

  // Sticky bottom ad close handler
  const btnCloseStickyAd = document.getElementById('btn-close-sticky-ad');
  const stickyFooterAd = document.getElementById('sticky-footer-ad');
  if (btnCloseStickyAd && stickyFooterAd) {
    btnCloseStickyAd.addEventListener('click', () => {
      stickyFooterAd.style.display = 'none';
      document.body.style.paddingBottom = '0px';
    });
  }

});
