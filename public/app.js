/**
 * INSTAFETCH SUITE - FRONTEND SPA APPLICATION LOGIC
 * Features: Comment Scraper + CSV Export, Video Downloader, Song Downloader,
 * Left Slide Drawer Navigation, Browser Session Storage, Legal Modals
 */

document.addEventListener('DOMContentLoaded', () => {
  // SPA Panels & Navigation
  const viewPanels = document.querySelectorAll('.view-panel');
  const drawer = document.getElementById('app-drawer');
  const drawerOverlay = document.getElementById('drawer-overlay');
  const btnOpenDrawer = document.getElementById('btn-open-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  const brandLogoBtn = document.getElementById('brand-logo-btn');

  // Session ID Modal Elements
  const sessionModal = document.getElementById('session-modal');
  const btnCloseSessionModal = document.getElementById('btn-close-session-modal');
  const sessionModalForm = document.getElementById('session-modal-form');
  const modalSessionInput = document.getElementById('modal-session-input');
  const btnToggleModalPass = document.getElementById('btn-toggle-modal-pass');
  const btnSessionKeyTrigger = document.getElementById('btn-session-key-trigger');
  const sessionStatusLabel = document.getElementById('session-status-label');
  const btnDrawerSession = document.getElementById('btn-drawer-session');

  // Legal Modal Elements
  const legalModal = document.getElementById('legal-modal');
  const legalModalTitle = document.getElementById('legal-modal-title');
  const btnCloseLegalModal = document.getElementById('btn-close-legal-modal');
  const btnOpenLegalTerms = document.getElementById('btn-open-legal-terms');
  const btnOpenLegalDmca = document.getElementById('btn-open-legal-dmca');
  const btnOpenLegalFairuse = document.getElementById('btn-open-legal-fairuse');
  const legalTabBtns = document.querySelectorAll('.legal-tab-btn');
  const legalTabContents = document.querySelectorAll('.legal-tab-content');

  // Modal Instruction Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // Feature 1: Scraper Elements
  const scraperForm = document.getElementById('scraper-form');
  const scraperUrlInput = document.getElementById('scraper-url');
  const btnSubmitScraper = document.getElementById('btn-submit-scraper');
  const spinnerScraper = document.getElementById('spinner-scraper');
  const statusCardScraper = document.getElementById('status-card-scraper');
  const errorCardScraper = document.getElementById('error-card-scraper');
  const errorMsgScraper = document.getElementById('error-msg-scraper');
  const resultsScraper = document.getElementById('results-scraper');
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const sortSelect = document.getElementById('sort-select');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const renderedCountText = document.getElementById('rendered-count-text');
  const commentsContainer = document.getElementById('comments-container');
  const lazySentinel = document.getElementById('lazy-sentinel');
  const lazyLoader = document.getElementById('lazy-loader');
  const btnLoadMoreComments = document.getElementById('btn-load-more-comments');
  const feedEndMessage = document.getElementById('feed-end-message');

  // Feature 2: Video Downloader Elements
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

  // Feature 3: Song Downloader Elements
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

  // Clipboard Paste Buttons
  const pasteBtns = document.querySelectorAll('.btn-paste-input');

  // State Variables
  let allComments = [];
  let filteredComments = [];
  let renderedIndex = 0;
  const BATCH_SIZE = 12; // Instagram-style progressive batch size (starts with first few comments)
  let observer = null;
  let activeShortcode = 'post';


  /* ==========================================
     SESSION STORAGE MANAGER (Browser Cookies)
     ========================================== */
  function getSessionId() {
    return sessionStorage.getItem('insta_session_id') || '';
  }

  function setSessionId(id) {
    if (id) {
      sessionStorage.setItem('insta_session_id', id.trim());
      updateSessionStatusBadge(true);
    } else {
      sessionStorage.removeItem('insta_session_id');
      updateSessionStatusBadge(false);
    }
  }

  function updateSessionStatusBadge(isSet) {
    if (isSet) {
      sessionStatusLabel.textContent = 'Session Active (Fast)';
      btnSessionKeyTrigger.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    } else {
      sessionStatusLabel.textContent = 'Fastest Mode (Optional)';
      btnSessionKeyTrigger.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    }
  }

  updateSessionStatusBadge(Boolean(getSessionId()));

  function ensureSessionId() {
    const currentId = getSessionId();
    if (!currentId) {
      openSessionModal();
      return false;
    }
    return currentId;
  }

  /* ==========================================
     SPA ROUTER & SLIDE DRAWER
     ========================================== */
  function navigateTo(targetViewId) {
    viewPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === targetViewId);
    });

    document.querySelectorAll('.drawer-link').forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-target') === targetViewId);
    });

    if (targetViewId === 'view-home') {
      btnOpenDrawer.classList.add('hidden');
      closeDrawer();
    } else {
      btnOpenDrawer.classList.remove('hidden');
      closeDrawer();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  brandLogoBtn.addEventListener('click', () => navigateTo('view-home'));

  document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('click', () => {
      const target = card.getAttribute('data-target');
      navigateTo(target);
    });
  });

  document.querySelectorAll('.drawer-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      navigateTo(target);
    });
  });

  btnOpenDrawer.addEventListener('click', openDrawer);
  btnCloseDrawer.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.remove('hidden');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.add('hidden');
  }

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
        alert('Clipboard permission denied. Please paste manually.');
      }
    });
  });

  /* ==========================================
     SECURITY & SESSION ID MODAL
     ========================================== */
  btnSessionKeyTrigger.addEventListener('click', openSessionModal);
  btnDrawerSession.addEventListener('click', () => {
    closeDrawer();
    openSessionModal();
  });
  btnCloseSessionModal.addEventListener('click', closeSessionModal);

  sessionModal.addEventListener('click', (e) => {
    if (e.target === sessionModal) closeSessionModal();
  });

  function openSessionModal() {
    modalSessionInput.value = getSessionId();
    sessionModal.classList.remove('hidden');
  }

  function closeSessionModal() {
    sessionModal.classList.add('hidden');
  }

  btnToggleModalPass.addEventListener('click', () => {
    const isPass = modalSessionInput.type === 'password';
    modalSessionInput.type = isPass ? 'text' : 'password';
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId)?.classList.add('active');
    });
  });

  sessionModalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newId = modalSessionInput.value.trim();
    if (!newId) return;
    setSessionId(newId);
    closeSessionModal();
  });

  /* ==========================================
     LEGAL MODAL HANDLERS
     ========================================== */
  btnOpenLegalTerms.addEventListener('click', () => openLegalModal('legal-tab-storage'));
  btnOpenLegalDmca.addEventListener('click', () => openLegalModal('legal-tab-dmca'));
  btnOpenLegalFairuse.addEventListener('click', () => openLegalModal('legal-tab-fairuse'));
  btnCloseLegalModal.addEventListener('click', closeLegalModal);

  legalModal.addEventListener('click', (e) => {
    if (e.target === legalModal) closeLegalModal();
  });

  function openLegalModal(defaultTabId) {
    legalModal.classList.remove('hidden');
    switchLegalTab(defaultTabId);
  }

  function closeLegalModal() {
    legalModal.classList.add('hidden');
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

  /* ==========================================
     FEATURE 1: COMMENT & REPLIES SCRAPER
     ========================================== */
  let currentEventSource = null;

  scraperForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const customSessionInput = document.getElementById('scraper-custom-session');
    const sessionId = (customSessionInput && customSessionInput.value.trim()) || getSessionId() || '';

    const postUrl = scraperUrlInput.value.trim();
    if (!postUrl) return;

    // Terminate previous stream if active
    if (currentEventSource) {
      try { currentEventSource.close(); } catch (_) {}
      currentEventSource = null;
    }

    errorCardScraper.classList.add('hidden');
    resultsScraper.classList.add('hidden');
    statusCardScraper.classList.add('hidden');
    btnSubmitScraper.disabled = true;
    spinnerScraper.classList.remove('hidden');

    allComments = [];
    renderedIndex = 0;
    commentsContainer.innerHTML = '';

    const noticeBanner = document.getElementById('comment-notice-banner');
    const noticeIcon = document.getElementById('notice-icon');
    const noticeTitle = document.getElementById('notice-status-title');
    const noticeDesc = document.getElementById('notice-status-desc');

    if (noticeBanner) {
      noticeBanner.className = 'comment-notice-banner';
      if (noticeIcon) noticeIcon.textContent = '⏳';
      if (noticeTitle) noticeTitle.textContent = 'Pro Tip:';
      if (noticeDesc) noticeDesc.textContent = 'For 100% complete and exact comment extraction, please wait until all background comments finish loading.';
    }

    let streamCompleted = false;
    let streamError = null;
    let instagramTotal = 0;

    // First batch promise: resolves as soon as batch 1 arrives with comments
    let resolveFirstBatch, rejectFirstBatch;
    let isFirstBatchSettled = false;
    const firstBatchPromise = new Promise((resolve, reject) => {
      resolveFirstBatch = (val) => {
        if (!isFirstBatchSettled) {
          isFirstBatchSettled = true;
          resolve(val);
        }
      };
      rejectFirstBatch = (err) => {
        if (!isFirstBatchSettled) {
          isFirstBatchSettled = true;
          reject(err);
        }
      };
    });

    const sseUrl = `/api/scrape-comments-stream?postUrl=${encodeURIComponent(postUrl)}&sessionId=${encodeURIComponent(sessionId)}`;
    const evtSource = new EventSource(sseUrl);
    currentEventSource = evtSource;

    // 12s Safety Timeout: Prevent permanent hanging under dead network connections
    const timeoutId = setTimeout(() => {
      if (allComments.length === 0) {
        evtSource.close();
        currentEventSource = null;
        rejectFirstBatch(new Error('Instagram connection timed out. The post may be private, comments disabled, or Session ID expired.'));
      }
    }, 12000);

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'error') {
          clearTimeout(timeoutId);
          evtSource.close();
          currentEventSource = null;
          streamError = new Error(data.error || 'Failed to stream comments.');
          rejectFirstBatch(streamError);
          return;
        }

        if (data.type === 'batch') {
          clearTimeout(timeoutId);
          if (data.shortcode) activeShortcode = data.shortcode;
          if (data.instagramTotalCount) instagramTotal = data.instagramTotalCount;
          const newComments = data.comments || [];
          allComments.push(...newComments);

          const repliesCount = allComments.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0);
          const combined = allComments.length + repliesCount;

          // Update live count badge inside modal if modal is open
          if (scraperAdCount) {
            scraperAdCount.textContent = `${combined.toLocaleString()} Comments Loaded So Far`;
          }

          // Update toolbar badge on results section
          const liveTotalBadge = document.getElementById('live-total-badge');
          if (liveTotalBadge) {
            if (instagramTotal > 0) {
              liveTotalBadge.textContent = `💬 Extracted ${combined.toLocaleString()} / ${instagramTotal.toLocaleString()} Total Comments`;
            } else {
              liveTotalBadge.textContent = `💬 Extracted ${combined.toLocaleString()} Comments (Streaming...)`;
            }
          }

          // Update background live streaming progress bar
          const liveStreamProgressMsg = document.getElementById('live-stream-progress-msg');
          if (liveStreamProgressMsg) {
            liveStreamProgressMsg.textContent = `⚡ Live Streaming in background: ${combined.toLocaleString()} comments loaded... You can browse & search now!`;
          }

          // Settle firstBatchPromise immediately
          if (allComments.length > 0) {
            resolveFirstBatch(allComments);
          }

          // In-memory update for results if results view is already active
          if (!resultsScraper.classList.contains('hidden')) {
            filterAndSortData();
            updateCountText();
            if (renderedIndex < filteredComments.length) {
              if (btnLoadMoreComments) btnLoadMoreComments.classList.remove('hidden');
              if (feedEndMessage) feedEndMessage.classList.add('hidden');
            }
          }
        }

        if (data.type === 'done') {
          clearTimeout(timeoutId);
          evtSource.close();
          currentEventSource = null;
          streamCompleted = true;

          const liveStreamProgressBar = document.getElementById('live-stream-progress-bar');
          if (liveStreamProgressBar) liveStreamProgressBar.classList.add('hidden');

          const repliesCount = allComments.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0);
          const combined = allComments.length + repliesCount;
          const liveTotalBadge = document.getElementById('live-total-badge');
          if (liveTotalBadge) {
            liveTotalBadge.textContent = `✅ Extracted ${combined.toLocaleString()} Total Comments`;
          }
          if (noticeBanner) {
            noticeBanner.className = 'comment-notice-banner notice-complete';
            if (noticeIcon) noticeIcon.textContent = '✅';
            if (noticeTitle) noticeTitle.textContent = 'Extraction Complete:';
            if (noticeDesc) noticeDesc.textContent = 'All comments and nested replies have been 100% extracted successfully!';
          }

          if (allComments.length === 0) {
            rejectFirstBatch(new Error('No comments found on this post. (Comments may be turned off or post is private).'));
          } else {
            resolveFirstBatch(allComments);
          }

          filterAndSortData();
          updateCountText();
          if (renderedIndex >= filteredComments.length && filteredComments.length > 0) {
            if (btnLoadMoreComments) btnLoadMoreComments.classList.add('hidden');
            if (feedEndMessage) feedEndMessage.classList.remove('hidden');
          }
        }

      } catch (err) {
        clearTimeout(timeoutId);
        evtSource.close();
        currentEventSource = null;
        rejectFirstBatch(err);
      }
    };

    evtSource.onerror = (err) => {
      clearTimeout(timeoutId);
      evtSource.close();
      currentEventSource = null;
      if (allComments.length > 0) {
        resolveFirstBatch(allComments);
      } else {
        rejectFirstBatch(new Error('Instagram did not return comments. Please verify URL is public and your Session ID is valid.'));
      }
    };

    try {
      // Run 4-Second Quick Ad & Progress Modal
      startCompulsoryScraperAdTimer();

      // Wait 4 seconds for ad timer
      await new Promise(r => setTimeout(r, 4000));

      // Hide modal after 4s guaranteed
      if (scraperAdModal) scraperAdModal.classList.add('hidden');

      // If initial comments have not arrived yet at 4s, show smooth loading status and await first batch
      if (allComments.length === 0) {
        const statusCardTitle = statusCardScraper.querySelector('.status-text h3');
        const statusCardDesc = statusCardScraper.querySelector('.status-text p');
        if (statusCardTitle) statusCardTitle.textContent = 'Connecting to Instagram Live Stream...';
        if (statusCardDesc) statusCardDesc.textContent = 'Opening comment feed the instant initial comments arrive (1-2s)...';
        statusCardScraper.classList.remove('hidden');
        statusCardScraper.scrollIntoView({ behavior: 'smooth' });

        // Wait ONLY for first batch (up to 5s safety race) - NEVER wait for all 5,000 comments!
        await Promise.race([
          firstBatchPromise,
          new Promise((_, reject) => setTimeout(() => {
            reject(new Error('Connecting to Instagram took too long. Please verify the URL or try pasting a Session ID.'));
          }, 5000))
        ]);

        statusCardScraper.classList.add('hidden');
      }

      if (allComments.length === 0) {
        throw new Error('No comments found on this post. (Note: Comments may be disabled on this post or the account is private).');
      }

      // SHOW RESULTS IMMEDIATELY - User gets instant access without waiting for 5,000 comments!
      resultsScraper.classList.remove('hidden');

      // Re-enable form submit button & hide spinner right now so user never sees a stuck button
      btnSubmitScraper.disabled = false;
      spinnerScraper.classList.add('hidden');

      // Show background streaming progress bar if more comments are continuing in background
      const liveStreamProgressBar = document.getElementById('live-stream-progress-bar');
      const liveStreamProgressMsg = document.getElementById('live-stream-progress-msg');
      if (liveStreamProgressBar) {
        if (!streamCompleted) {
          liveStreamProgressBar.classList.remove('hidden');
          if (liveStreamProgressMsg) {
            const repliesCount = allComments.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0);
            const combined = allComments.length + repliesCount;
            liveStreamProgressMsg.textContent = `⚡ Live Streaming in background: ${combined.toLocaleString()} comments loaded... You can browse & search now!`;
          }
        } else {
          liveStreamProgressBar.classList.add('hidden');
        }
      }

      searchInput.value = '';
      sortSelect.value = 'likes';
      applyFilterAndSort();
      resultsScraper.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
      if (scraperAdModal) scraperAdModal.classList.add('hidden');
      statusCardScraper.classList.add('hidden');
      errorMsgScraper.textContent = err.message;
      errorCardScraper.classList.remove('hidden');
      errorCardScraper.scrollIntoView({ behavior: 'smooth' });

      // Automatically open the custom session accordion if session needs refresh
      if (err.message.includes('Session ID') || err.message.includes('expired') || err.message.includes('private') || err.message.includes('challenged')) {
        const customDetails = document.getElementById('scraper-custom-session-details');
        if (customDetails) customDetails.open = true;
      }
    } finally {
      btnSubmitScraper.disabled = false;
      spinnerScraper.classList.add('hidden');
    }
  });


  searchInput.addEventListener('input', () => {
    btnClearSearch.classList.toggle('hidden', !searchInput.value);
    applyFilterAndSort();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    btnClearSearch.classList.add('hidden');
    applyFilterAndSort();
  });

  sortSelect.addEventListener('change', applyFilterAndSort);

  /* EXPORT ALL COMMENTS & REPLIES TO CSV (Compulsory 15s Ad) */
  btnExportCsv.addEventListener('click', () => {
    if (!filteredComments || filteredComments.length === 0) {
      return alert('No comments available to export.');
    }

    triggerCsvExportWithAd(() => {
      const csvRows = [];
      csvRows.push(['Comment ID', 'Type', 'Username', 'Full Name', 'Comment Text', 'Likes Count', 'Timestamp', 'Is Verified', 'Is Pinned', 'GIF URL']);

      filteredComments.forEach(parent => {
        // Add Main Comment
        csvRows.push([
          parent.id,
          'Main Comment',
          parent.username,
          parent.fullName,
          parent.text,
          parent.likesCount,
          parent.createdAtFormatted,
          parent.isVerified ? 'Yes' : 'No',
          parent.isPinned ? 'Yes' : 'No',
          parent.gifUrl || ''
        ]);

        // Add Child Replies
        if (parent.replies && parent.replies.length > 0) {
          parent.replies.forEach(reply => {
            csvRows.push([
              reply.id,
              `Reply to @${parent.username}`,
              reply.username,
              reply.fullName,
              reply.text,
              reply.likesCount,
              reply.createdAtFormatted,
              reply.isVerified ? 'Yes' : 'No',
              reply.isPinned ? 'Yes' : 'No',
              reply.gifUrl || ''
            ]);
          });
        }
      });

      let csvContent = '';
      csvRows.forEach(row => {
        csvContent += row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(',') + '\n';
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `instaclipper_comments_${activeShortcode}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  });

  function filterAndSortData() {
    const query = searchInput.value.trim().toLowerCase();

    if (!query) {
      filteredComments = [...allComments];
    } else {
      filteredComments = allComments.filter(c => {
        const u = (c.username || '').toLowerCase();
        const f = (c.fullName || '').toLowerCase();
        const t = (c.text || '').toLowerCase();
        const replyMatch = c.replies && c.replies.some(r =>
          (r.username || '').toLowerCase().includes(query) ||
          (r.fullName || '').toLowerCase().includes(query) ||
          (r.text || '').toLowerCase().includes(query)
        );
        return u.includes(query) || f.includes(query) || t.includes(query) || replyMatch;
      });
    }

    const sortVal = sortSelect.value;
    if (sortVal === 'newest') filteredComments.sort((a, b) => b.createdAt - a.createdAt);
    else if (sortVal === 'oldest') filteredComments.sort((a, b) => a.createdAt - b.createdAt);
    else if (sortVal === 'likes') filteredComments.sort((a, b) => b.likesCount - a.likesCount);

    // ALWAYS PIN PINNED COMMENTS AT THE VERY TOP OF THE LIST!
    filteredComments.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
  }

  function applyFilterAndSort() {
    filterAndSortData();
    commentsContainer.innerHTML = '';
    renderedIndex = 0;
    renderNextBatch();
    setupIntersectionObserver();
  }

  // Sticky Footer Ad Close Handler
  const btnCloseStickyAd = document.getElementById('btn-close-sticky-ad');
  const stickyFooterAd = document.getElementById('sticky-footer-ad');
  if (btnCloseStickyAd && stickyFooterAd) {
    btnCloseStickyAd.addEventListener('click', () => {
      stickyFooterAd.style.display = 'none';
      document.body.style.paddingBottom = '0px';
    });
  }

  function renderNextBatch() {
    if (renderedIndex >= filteredComments.length) {
      lazyLoader.classList.add('hidden');
      if (btnLoadMoreComments) btnLoadMoreComments.classList.add('hidden');
      if (feedEndMessage && filteredComments.length > 0) feedEndMessage.classList.remove('hidden');
      updateCountText();
      return;
    }

    lazyLoader.classList.remove('hidden');
    if (btnLoadMoreComments) btnLoadMoreComments.classList.add('hidden');

    const query = searchInput.value.trim().toLowerCase();
    const nextChunk = filteredComments.slice(renderedIndex, renderedIndex + BATCH_SIZE);
    const fragment = document.createDocumentFragment();

    nextChunk.forEach((c, idx) => {
      const card = createCommentCardWrapper(c, query);
      fragment.appendChild(card);

      // Insert Native In-Feed Ad every 15 comments
      const currentPos = renderedIndex + idx + 1;
      if (currentPos % 15 === 0 && currentPos < filteredComments.length) {
        const adCard = createInFeedAdCard(currentPos);
        fragment.appendChild(adCard);
      }
    });

    commentsContainer.appendChild(fragment);
    renderedIndex += nextChunk.length;

    lazyLoader.classList.add('hidden');

    if (renderedIndex < filteredComments.length) {
      if (btnLoadMoreComments) btnLoadMoreComments.classList.remove('hidden');
      if (feedEndMessage) feedEndMessage.classList.add('hidden');
    } else {
      if (btnLoadMoreComments) btnLoadMoreComments.classList.add('hidden');
      if (feedEndMessage && filteredComments.length > 0) feedEndMessage.classList.remove('hidden');
    }

    updateCountText();
  }

  if (btnLoadMoreComments) {
    btnLoadMoreComments.addEventListener('click', () => {
      renderNextBatch();
    });
  }


  function createInFeedAdCard(index) {
    const card = document.createElement('div');
    card.className = 'comment-card-wrapper ad-unit infeed-ad-card glass-card';
    card.style.margin = '12px 0';
    card.style.padding = '16px';
    
    card.innerHTML = `<div class="ad-label" style="margin-bottom: 4px;">SPONSORED ADVERTISEMENT</div>`;

    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.maxWidth = '728px';
    iframe.style.height = '90px';
    iframe.style.border = 'none';
    iframe.style.overflow = 'hidden';
    iframe.style.background = 'transparent';

    card.appendChild(iframe);

    setTimeout(() => {
      try {
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
          <body style="margin:0;padding:0;display:flex;justify-content:center;align-items:center;background:transparent;">
            <script type="text/javascript">
              atOptions = {
                'key' : '1fba62e78b7b1bb355de2179b8e4c0d3',
                'format' : 'iframe',
                'height' : 90,
                'width' : 728,
                'params' : {}
              };
            </script>
            <script type="text/javascript" src="https://www.highrevenueformat.com/1fba62e78b7b1bb355de2179b8e4c0d3/invoke.js"></script>
          </body>
          </html>
        `);
        doc.close();
      } catch (err) {}
    }, 10);

    return card;
  }

  function updateCountText() {
    const renderedChunk = filteredComments.slice(0, renderedIndex);
    const renderedReplies = renderedChunk.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0);
    const total = renderedIndex + renderedReplies;
    renderedCountText.textContent = `Showing ${renderedIndex.toLocaleString()} main comments + ${renderedReplies.toLocaleString()} replies (Total: ${total.toLocaleString()} comments loaded)`;
  }

  function setupIntersectionObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && renderedIndex < filteredComments.length) {
        renderNextBatch();
      }
    }, { rootMargin: '100px', threshold: 0.1 });
    observer.observe(lazySentinel);
  }

  function createCommentCardWrapper(comment, searchQuery) {
    const wrapper = document.createElement('div');
    wrapper.className = 'comment-card-wrapper';

    const defaultAvatar = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="%238e99ac"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
    const avatarSrc = comment.profilePic || defaultAvatar;

    let parentGifHtml = '';
    if (comment.gifUrl) {
      const isVideo = /\.mp4|\.webm/i.test(comment.gifUrl);
      if (isVideo) {
        parentGifHtml = `<div class="comment-gif-box"><video src="${comment.gifUrl}" class="comment-gif-img" autoplay loop muted playsinline controls></video></div>`;
      } else {
        parentGifHtml = `<div class="comment-gif-box"><img src="${comment.gifUrl}" class="comment-gif-img" alt="GIF" loading="lazy"></div>`;
      }
    }

    const hasParentText = comment.text && comment.text.trim().length > 0;
    const parentCard = document.createElement('div');
    parentCard.className = `comment-card ${comment.isPinned ? 'pinned-card' : ''}`;
    parentCard.innerHTML = `
      <div class="avatar-container">
        <img class="avatar-img" src="${avatarSrc}" alt="${comment.username}" loading="lazy" onerror="this.src='${defaultAvatar}'">
      </div>
      <div class="comment-content">
        <div class="comment-meta">
          <div class="user-details">
            ${comment.isPinned ? '<span class="pinned-badge">📌 PINNED</span>' : ''}
            <a href="https://instagram.com/${comment.username}" target="_blank" rel="noopener" class="username">@${highlightText(comment.username, searchQuery)}</a>
            ${comment.isVerified ? '<span class="verified-icon">☑️</span>' : ''}
            ${comment.fullName ? `<span class="fullname">${highlightText(comment.fullName, searchQuery)}</span>` : ''}
          </div>
          <span class="timestamp">${comment.createdAtFormatted}</span>
        </div>
        ${hasParentText ? `<div class="comment-text">${highlightText(comment.text, searchQuery)}</div>` : ''}
        ${parentGifHtml}
        <div class="comment-stats">
          <div class="stats-left">
            ${comment.likesCount > 0 ? `<span class="like-badge">❤️ ${comment.likesCount.toLocaleString()} likes</span>` : ''}
            ${comment.replies && comment.replies.length > 0 ? `<span>💬 ${comment.replies.length} replies</span>` : ''}
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${comment.gifUrl ? `
              <a href="/api/download-stream?url=${encodeURIComponent(comment.gifUrl)}&filename=instaclipper_gif_${comment.id}.gif&type=image" class="btn-download-gif" title="Download GIF">
                🎬 Download GIF
              </a>
            ` : ''}
            <button type="button" class="btn-copy-card" title="Copy text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>Copy</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const copyBtn = parentCard.querySelector('.btn-copy-card');
    copyBtn.addEventListener('click', () => copyCommentToClipboard(comment.username, comment.text || '[GIF]', copyBtn));

    const pGifBtn = parentCard.querySelector('.btn-download-gif');
    if (pGifBtn) {
      pGifBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const href = pGifBtn.getAttribute('href');
        if (!href) return;
        triggerDownloadWithAd(() => {
          window.location.href = href;
        });
      });
    }

    wrapper.appendChild(parentCard);

    if (comment.replies && comment.replies.length > 0) {
      const repliesCount = comment.replies.length;
      const repliesContainer = document.createElement('div');
      repliesContainer.className = 'replies-container hidden';

      // Check if search query matches any reply — if so, auto-expand
      const hasSearchMatchInReply = searchQuery && comment.replies.some(r =>
        (r.username || '').toLowerCase().includes(searchQuery) ||
        (r.fullName || '').toLowerCase().includes(searchQuery) ||
        (r.text || '').toLowerCase().includes(searchQuery)
      );

      if (hasSearchMatchInReply) {
        repliesContainer.classList.remove('hidden');
      }

      // Instagram-style View Replies Toggle Button
      const toggleRepliesBtn = document.createElement('button');
      toggleRepliesBtn.type = 'button';
      toggleRepliesBtn.className = 'btn-toggle-replies';
      toggleRepliesBtn.innerHTML = `<span class="reply-line"></span><span>${hasSearchMatchInReply ? 'Hide' : 'View'} ${repliesCount} ${repliesCount === 1 ? 'reply' : 'replies'}</span>`;

      toggleRepliesBtn.addEventListener('click', () => {
        const isHidden = repliesContainer.classList.contains('hidden');
        repliesContainer.classList.toggle('hidden');
        if (isHidden) {
          toggleRepliesBtn.innerHTML = `<span class="reply-line"></span><span>Hide ${repliesCount === 1 ? 'reply' : 'replies'}</span>`;
        } else {
          toggleRepliesBtn.innerHTML = `<span class="reply-line"></span><span>View ${repliesCount} ${repliesCount === 1 ? 'reply' : 'replies'}</span>`;
        }
      });

      comment.replies.forEach(reply => {
        let replyGifHtml = '';
        if (reply.gifUrl) {
          const isReplyVideo = /\.mp4|\.webm/i.test(reply.gifUrl);
          if (isReplyVideo) {
            replyGifHtml = `<div class="comment-gif-box"><video src="${reply.gifUrl}" class="comment-gif-img" autoplay loop muted playsinline controls></video></div>`;
          } else {
            replyGifHtml = `<div class="comment-gif-box"><img src="${reply.gifUrl}" class="comment-gif-img" alt="GIF" loading="lazy"></div>`;
          }
        }

        const hasReplyText = reply.text && reply.text.trim().length > 0;
        const replyCard = document.createElement('div');
        replyCard.className = 'reply-card';
        replyCard.innerHTML = `
          <div class="avatar-container reply-avatar">
            <img class="avatar-img" src="${reply.profilePic || defaultAvatar}" alt="${reply.username}" loading="lazy" onerror="this.src='${defaultAvatar}'">
          </div>
          <div class="comment-content">
            <div class="comment-meta">
              <div class="user-details">
                ${reply.isPinned ? '<span class="pinned-badge">📌 PINNED</span>' : ''}
                <a href="https://instagram.com/${reply.username}" target="_blank" rel="noopener" class="username">@${highlightText(reply.username, searchQuery)}</a>
                ${reply.fullName ? `<span class="fullname">${highlightText(reply.fullName, searchQuery)}</span>` : ''}
              </div>
              <span class="timestamp">${reply.createdAtFormatted}</span>
            </div>
            ${hasReplyText ? `<div class="comment-text">${highlightText(reply.text, searchQuery)}</div>` : ''}
            ${replyGifHtml}
            <div class="comment-stats">
              <div class="stats-left">
                ${reply.likesCount > 0 ? `<span class="like-badge">❤️ ${reply.likesCount.toLocaleString()} likes</span>` : ''}
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                ${reply.gifUrl ? `
                  <a href="/api/download-stream?url=${encodeURIComponent(reply.gifUrl)}&filename=instaclipper_gif_${reply.id}.gif&type=image" class="btn-download-gif" title="Download GIF">
                    🎬 Download GIF
                  </a>
                ` : ''}
                <button type="button" class="btn-copy-card" title="Copy text">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span>Copy</span>
                </button>
              </div>
            </div>
          </div>
        `;
        const rCopyBtn = replyCard.querySelector('.btn-copy-card');
        rCopyBtn.addEventListener('click', () => copyCommentToClipboard(reply.username, reply.text, rCopyBtn));

        const rGifBtn = replyCard.querySelector('.btn-download-gif');
        if (rGifBtn) {
          rGifBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const href = rGifBtn.getAttribute('href');
            if (!href) return;
            triggerDownloadWithAd(() => {
              window.location.href = href;
            });
          });
        }

        repliesContainer.appendChild(replyCard);
      });

      wrapper.appendChild(toggleRepliesBtn);
      wrapper.appendChild(repliesContainer);
    }


    return wrapper;
  }

  async function copyCommentToClipboard(username, text, btnElement) {
    try {
      await navigator.clipboard.writeText(`@${username}: ${text}`);
      btnElement.classList.add('copied');
      btnElement.innerHTML = `<span>✅ Copied!</span>`;
      setTimeout(() => {
        btnElement.classList.remove('copied');
        btnElement.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>`;
      }, 1500);
    } catch (err) {
      alert('Failed to copy to clipboard.');
    }
  }

  /* ==========================================
     FEATURE 2: VIDEO DOWNLOADER HANDLER
     ========================================== */
  videoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sessionId = getSessionId() || '';

    const postUrl = videoUrlInput.value.trim();
    if (!postUrl) return;

    errorCardVideo.classList.add('hidden');
    resultsVideo.classList.add('hidden');
    btnSubmitVideo.disabled = true;
    spinnerVideo.classList.remove('hidden');

    try {
      const response = await fetch('/api/fetch-video-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postUrl, sessionId })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch video.');
      }

      const filename = `instaclipper_video_${data.shortcode}.mp4`;
      const streamUrl = `/api/download-stream?url=${encodeURIComponent(data.videoUrl)}&filename=${encodeURIComponent(filename)}&type=video`;

      // Use direct CDN URL for preview player (prevents auto-download & supports seeking)
      videoPlayer.src = data.videoUrl;
      if (data.thumbnail) videoPlayer.poster = data.thumbnail;
      videoUsername.textContent = `@${data.username}`;
      videoResolution.textContent = `HD ${data.width}x${data.height}`;
      videoCaption.textContent = data.caption || 'No caption available.';

      // Stream URL only for the download button (goes through SSRF-protected proxy)
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

  /* ==========================================
     FEATURE 3: SONG / AUDIO DOWNLOADER HANDLER
     ========================================== */
  songForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sessionId = getSessionId() || '';

    const postUrl = songUrlInput.value.trim();
    if (!postUrl) return;

    errorCardSong.classList.add('hidden');
    resultsSong.classList.add('hidden');
    btnSubmitSong.disabled = true;
    spinnerSong.classList.remove('hidden');

    try {
      const response = await fetch('/api/fetch-song-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postUrl, sessionId })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch audio track.');
      }

      // Generate High-Quality MP3 Download Stream
      const filename = `instaclipper_song_${data.shortcode}.mp3`;
      const audioStreamUrl = `/api/download-stream?url=${encodeURIComponent(data.audioUrl)}&filename=${encodeURIComponent(filename)}&type=audio`;

      // Use direct CDN URL for instant audio preview player (prevents auto-download, supports seeking)
      audioPlayer.src = data.audioUrl;
      songTitle.textContent = data.title || 'Original Audio';
      songArtist.textContent = `@${data.artist}`;
      songArtwork.src = data.artwork || 'https://via.placeholder.com/160?text=Music';

      // Always pure MP3 download button
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

  /* ==========================================
     1. INTERSTITIAL AD MODAL FOR DOWNLOADS (5s Wait + User Controls)
     ========================================== */
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

  // Intercept Video & Audio Download Clicks
  btnDownloadMp4.addEventListener('click', (e) => {
    e.preventDefault();
    const href = btnDownloadMp4.getAttribute('href');
    if (!href || href === '#' || href.endsWith('#')) return;
    triggerDownloadWithAd(() => {
      window.location.href = href;
    });
  });

  btnDownloadMp3.addEventListener('click', (e) => {
    e.preventDefault();
    const href = btnDownloadMp3.getAttribute('href');
    if (!href || href === '#' || href.endsWith('#')) return;
    triggerDownloadWithAd(() => {
      window.location.href = href;
    });
  });

  /* ==========================================
     2. QUICK 4-SECOND SCRAPER AD & LIVE COUNTER MODAL
     ========================================== */
  const scraperAdModal = document.getElementById('scraper-ad-modal');
  const scraperAdSec = document.getElementById('scraper-ad-sec');
  const scraperAdProgressFill = document.getElementById('scraper-ad-progress-fill');
  const scraperAdCount = document.getElementById('scraper-ad-count');
  const scraperAdStatusMsg = document.getElementById('scraper-ad-status-msg');

  function startCompulsoryScraperAdTimer() {
    if (!scraperAdModal) return;

    let secondsPassed = 0;
    const totalSeconds = 4;

    if (scraperAdSec) scraperAdSec.textContent = totalSeconds;
    if (scraperAdProgressFill) scraperAdProgressFill.style.width = '0%';
    if (scraperAdCount) scraperAdCount.textContent = '0 Comments Loaded';
    if (scraperAdStatusMsg) scraperAdStatusMsg.textContent = 'Connecting to Instagram API... Loading results live!';
    scraperAdModal.classList.remove('hidden');

    const interval = setInterval(() => {
      secondsPassed++;
      const secondsLeft = Math.max(0, totalSeconds - secondsPassed);
      const pct = Math.min(100, Math.round((secondsPassed / totalSeconds) * 100));

      if (scraperAdSec) scraperAdSec.textContent = secondsLeft;
      if (scraperAdProgressFill) scraperAdProgressFill.style.width = `${pct}%`;

      if (secondsPassed >= totalSeconds) {
        clearInterval(interval);
        scraperAdModal.classList.add('hidden');
      }
    }, 1000);
  }

  /* ==========================================
     3. QUICK 3-SECOND CSV EXPORT AD MODAL
     ========================================== */
  const csvAdModal = document.getElementById('csv-ad-modal');
  const csvAdSec = document.getElementById('csv-ad-sec');
  const csvAdProgressFill = document.getElementById('csv-ad-progress-fill');

  function triggerCsvExportWithAd(actionCallback) {
    if (!csvAdModal) {
      actionCallback();
      return;
    }

    let secondsPassed = 0;
    const totalSeconds = 3;

    if (csvAdSec) csvAdSec.textContent = totalSeconds;
    if (csvAdProgressFill) csvAdProgressFill.style.width = '0%';
    csvAdModal.classList.remove('hidden');

    const interval = setInterval(() => {
      secondsPassed++;
      const secondsLeft = Math.max(0, totalSeconds - secondsPassed);
      const pct = Math.min(100, Math.round((secondsPassed / totalSeconds) * 100));

      if (csvAdSec) csvAdSec.textContent = secondsLeft;
      if (csvAdProgressFill) csvAdProgressFill.style.width = `${pct}%`;

      if (secondsPassed >= totalSeconds) {
        clearInterval(interval);
        csvAdModal.classList.add('hidden');
        actionCallback();
      }
    }, 1000);
  }

  function highlightText(text, query) {
    if (!text) return '';
    if (!query) return escapeHtml(text);
    const escText = escapeHtml(text);
    const escQuery = escapeHtml(query);
    const regex = new RegExp(`(${escQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escText.replace(regex, '<span class="highlight-match">$1</span>');
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

});


