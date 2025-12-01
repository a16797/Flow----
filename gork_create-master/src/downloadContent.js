// Grok 视频下载器内容脚本（合并版）
(function() {
  'use strict';

  let videoItems = [];
  let selectionPanel = null;
  let videoUrlSet = new Set();
  let observerStarted = false;

  function sanitizeUrl(url) {
    try {
      const u = new URL(url, location.href);
      return `${u.origin}${u.pathname}`;
    } catch {
      return String(url).split('#')[0].split('?')[0];
    }
  }

  function makeDefaultName(index) {
    return `grok_video_${index}`;
  }

  function tryAddVideo(videoEl) {
    if (!(videoEl instanceof HTMLVideoElement)) return false;
    let videoUrl = videoEl.src || videoEl.currentSrc || '';
    if (!videoUrl) {
      const s = videoEl.querySelector && videoEl.querySelector('source');
      if (s && s.src) videoUrl = s.src;
    }
    if (!videoUrl) return false;
    const key = sanitizeUrl(videoUrl);
    if (videoUrlSet.has(key)) return false;
    const posterUrl = videoEl.poster || '';
    const item = {
      index: videoItems.length + 1,
      key,
      videoUrl,
      posterUrl,
      element: videoEl,
      selected: false,
      name: makeDefaultName(videoItems.length + 1)
    };
    videoItems.push(item);
    videoUrlSet.add(key);
    return true;
  }

  function initialScan() {
    videoItems = [];
    videoUrlSet.clear();
    const videos = document.querySelectorAll('video');
    videos.forEach(v => tryAddVideo(v));
  }

  function ensureObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver(mutations => {
      let added = 0;
      for (const m of mutations) {
        m.addedNodes && m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('video')) {
            if (tryAddVideo(node)) added++;
          }
          const videos = node.querySelectorAll ? node.querySelectorAll('video') : [];
          videos && videos.forEach(v => { if (tryAddVideo(v)) added++; });
        });
      }
      if (added > 0 && selectionPanel) {
        renderList();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function renderList() {
    const list = selectionPanel && selectionPanel.querySelector('#gvd-video-list');
    const countEl = selectionPanel && selectionPanel.querySelector('#gvd-count');
    if (!list) return;
    list.innerHTML = videoItems.map((item, idx) => `
      <div class="gvd-video-item" data-index="${idx}">
        <input type="checkbox" class="gvd-checkbox" id="gvd-check-${idx}">
        <div class="gvd-video-preview">
          ${item.posterUrl ? `<img src="${item.posterUrl}" alt="预览">` : '<div class="gvd-no-preview">无预览</div>'}
          <div class="gvd-video-icon">▶</div>
        </div>
        <div class="gvd-video-info">
          <input type="text" class="gvd-name-input" value="${item.name}" placeholder="文件名">
          <div class="gvd-url">${item.videoUrl}</div>
        </div>
      </div>
    `).join('');
    if (countEl) countEl.textContent = String(videoItems.length);
  }

  function createSelectionPanel() {
    if (selectionPanel) selectionPanel.remove();
    if (videoItems.length === 0) initialScan();
    const panel = document.createElement('div');
    panel.id = 'grok-video-downloader-panel';
    const savedPrefix = localStorage.getItem('gvd_prefix') || '';
    panel.innerHTML = `
      <div class="gvd-header">
        <h3>视频下载器 - 找到 <span id="gvd-count">${videoItems.length}</span> 个视频</h3>
        <button class="gvd-close" id="gvd-close-btn">✕</button>
      </div>
      <div class="gvd-actions">
        <button id="gvd-select-all">全选</button>
        <button id="gvd-deselect-all">取消全选</button>
        <input id="gvd-prefix" class="gvd-prefix-input" placeholder="批量前缀(可选)" value="${savedPrefix}">
      </div>
      <div class="gvd-video-list" id="gvd-video-list"></div>
      <div class="gvd-footer">
        <button id="gvd-download-btn" class="gvd-download-btn">下载选中的视频</button>
      </div>
    `;
    document.body.appendChild(panel);
    selectionPanel = panel;
    renderList();
    panel.querySelector('#gvd-close-btn').addEventListener('click', () => {
      panel.remove();
      selectionPanel = null;
    });
    panel.querySelector('#gvd-select-all').addEventListener('click', () => {
      panel.querySelectorAll('.gvd-checkbox').forEach(cb => cb.checked = true);
    });
    panel.querySelector('#gvd-deselect-all').addEventListener('click', () => {
      panel.querySelectorAll('.gvd-checkbox').forEach(cb => cb.checked = false);
    });
    panel.querySelector('#gvd-prefix').addEventListener('input', (e) => {
      localStorage.setItem('gvd_prefix', e.target.value.trim());
    });
    panel.querySelector('#gvd-download-btn').addEventListener('click', downloadSelected);
  }

  async function downloadSelected() {
    if (!selectionPanel) return;
    const checkboxes = selectionPanel.querySelectorAll('.gvd-checkbox');
    const nameInputs = selectionPanel.querySelectorAll('.gvd-name-input');
    const prefix = (selectionPanel.querySelector('#gvd-prefix')?.value || '').trim();
    let selectedCount = 0;
    checkboxes.forEach((checkbox, index) => {
      if (checkbox.checked) {
        const item = videoItems[index];
        const baseName = (nameInputs[index].value || item.name).replace(/\.+$/, '');
        const filename = `${prefix ? prefix + '_' : ''}${baseName}.mp4`;
        chrome.runtime.sendMessage({ action: 'download', url: item.videoUrl, filename });
        selectedCount++;
      }
    });
    if (selectedCount === 0) {
      alert('请至少选择一个视频');
    } else {
      alert(`已开始下载 ${selectedCount} 个视频`);
      selectionPanel?.remove();
      selectionPanel = null;
    }
  }

  function createFloatingButton() {
    if (document.getElementById('grok-video-downloader-btn')) return;
    const button = document.createElement('button');
    button.id = 'grok-video-downloader-btn';
    button.className = 'gvd-floating-btn';
    button.textContent = '📥 下载视频';
    button.title = '点击选择要下载的视频';
    const posStr = localStorage.getItem('gvd_btn_pos');
    const pos = posStr ? JSON.parse(posStr) : null;
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      button.style.left = pos.left + 'px';
      button.style.top = pos.top + 'px';
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    }
    button.addEventListener('click', () => {
      if (button.__dragging || button.__justDragged) return;
      createSelectionPanel();
    });
    let startX, startY, startLeft, startTop, movedDuringDrag = false;
    const onPointerDown = (clientX, clientY) => {
      button.__dragging = true;
      startX = clientX; startY = clientY;
      const rect = button.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      movedDuringDrag = false;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    };
    const onMouseDown = (e) => { e.preventDefault(); onPointerDown(e.clientX, e.clientY); };
    const onTouchStart = (e) => { if (!e.touches[0]) return; onPointerDown(e.touches[0].clientX, e.touches[0].clientY); };
    const moveTo = (clientX, clientY) => {
      const dx = clientX - startX; const dy = clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedDuringDrag = true;
      let left = startLeft + dx; let top = startTop + dy;
      const vw = window.innerWidth; const vh = window.innerHeight;
      const br = button.getBoundingClientRect();
      left = Math.max(0, Math.min(vw - br.width, left));
      top = Math.max(0, Math.min(vh - br.height, top));
      button.style.left = left + 'px';
      button.style.top = top + 'px';
      button.style.right = 'auto';
      button.style.bottom = 'auto';
    };
    const onMouseMove = (e) => { moveTo(e.clientX, e.clientY); };
    const onTouchMove = (e) => { if (!e.touches[0]) return; e.preventDefault(); moveTo(e.touches[0].clientX, e.touches[0].clientY); };
    const endDrag = () => {
      button.__dragging = false;
      const r = button.getBoundingClientRect();
      localStorage.setItem('gvd_btn_pos', JSON.stringify({ left: r.left, top: r.top }));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (movedDuringDrag) {
        button.__justDragged = true;
        setTimeout(() => { button.__justDragged = false; }, 200);
      }
    };
    const onMouseUp = () => endDrag();
    const onTouchEnd = () => endDrag();
    button.addEventListener('mousedown', onMouseDown);
    button.addEventListener('touchstart', onTouchStart, { passive: true });
    document.body.appendChild(button);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openDownloader') {
      createSelectionPanel();
      sendResponse({ success: true });
    }
  });

  function init() {
    initialScan();
    ensureObserver();
    createFloatingButton();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();