/* Content Script: 在 grok.com/imagine* 上接收一条任务(图片+提示词)并执行流程 */

function logLocal(...args) { console.debug('[GrokBatch]', ...args); }

// 仍保留来自 popup 的单任务处理能力
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PROCESS_ONE') {
    processOne(msg).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
});

// 悬浮球 UI 注入（只在 imagine 页面上执行一次）
if (!window.__grokBatchInjected) {
  window.__grokBatchInjected = true;
  injectFloatingBall();
}

async function processOne(opts) {
  const { fileName, mimeType, base64, prompt, genTimeout, navTimeout, autoScroll } = opts;
  // Step 1: 确认在主页面 /imagine 而不是 /imagine/post
  if (location.pathname.startsWith('/imagine/post')) {
    // 如果已经在 post 页面，点击返回
    const backBtn = findButtonByAria('返回');
    if (backBtn) { 
      backBtn.click(); 
      await sleepRandom(800, 1200); 
    }
  }
  // 不再强制等待主页检测，直接继续（页面会自然跳转）
  // Step 2: 上传图片
  const file = base64ToFile(base64, fileName, mimeType);
  const successUpload = await attemptUpload(file, navTimeout);
  if (!successUpload) throw new Error('图片上传失败');
  await sleepRandom(500, 1000); // 上传后等待 0.5-1 秒
  
  // 检测是否被审核拦截（Content is moderated 或警告图标）
  const moderationDetected = await checkForModeration(3000);
  if (moderationDetected) {
    logLocal('检测到图片被审核，尝试清除并跳过');
    await clearModeratedImage();
    throw new Error('图片被审核拦截，已跳过');
  }
  // Step 3: 等待跳转到 /imagine/post/*
  await waitForPostPage(navTimeout);
  if (autoScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  // Step 4: 填写提示词
  const ta = findVideoPromptTextarea();
  if (!ta) throw new Error('未找到视频提示词 textarea');
  setNativeValue(ta, prompt || '');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await sleepRandom(0, 1000); // 随机延时 0-1s
  // Step 5: 点击生成视频按钮
  const genBtn = findButtonByAria('生成视频');
  if (!genBtn) throw new Error('未找到生成视频按钮');
  genBtn.click();
  await sleepRandom(0, 1000); // 随机延时 0-1s
  // Step 6: 等待生成完成或超时
  await waitForGeneration(genTimeout);
  // Step 7: 点击返回并短暂等待页面开始跳转
  const backBtn = findButtonByAria('返回');
  if (backBtn) {
    backBtn.click();
    await sleepRandom(800, 1200); // 返回后等待 0.8-1.2 秒即继续
  }
}

function base64ToFile(base64, name, mime) {
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new File([ab], name, { type: mime });
}

async function attemptUpload(file, timeout) {
  // 优先寻找 input[type=file]
  let input = document.querySelector('input[type=file]');
  if (!input) {
    // 可能在 shadow root 或延迟加载，尝试轮询
    input = await waitFor(() => document.querySelector('input[type=file]'), 1500);
  }
  if (input) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // 等待跳转触发
    return true;
  }
  // 尝试 paste 事件(可能不被支持)
  try {
    const blob = file;
    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
    const editor = document.querySelector('[data-placeholder]');
    if (editor) {
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }));
      return true;
    }
  } catch (e) {
    logLocal('paste 失败', e);
  }
  return false;
}

function findVideoPromptTextarea() {
  return document.querySelector('textarea[aria-label="制作视频"]');
}

function findButtonByAria(label) {
  return Array.from(document.querySelectorAll('button[aria-label]')).find(b => b.getAttribute('aria-label') === label);
}

function checkForModeration(timeout) {
  // 检测是否出现审核提示: "Content is moderated" 或警告三角图标
  return waitFor(() => {
    const moderatedText = document.body.textContent.includes('Content is moderated');
    const warningIcon = document.querySelector('svg.lucide-triangle-alert[aria-label="出错啦"]');
    return moderatedText || !!warningIcon;
  }, timeout).then(() => true).catch(() => false);
}

function clearModeratedImage() {
  // 查找并点击删除按钮（位于审核警告芯片中）
  const deleteBtn = document.querySelector('[aria-label="删除"]');
  if (deleteBtn) {
    deleteBtn.click();
    return sleepRandom(300, 500);
  }
  return Promise.resolve();
}

function waitForMainPage(timeout) {
  return waitFor(() => location.pathname === '/imagine', timeout);
}
function waitForPostPage(timeout) {
  return waitFor(() => location.pathname.startsWith('/imagine/post'), timeout);
}

function waitForGeneration(timeout) {
  // 简单策略：等待出现 video 或达到超时
  return waitFor(() => !!document.querySelector('video, canvas, img[data-generated-video]'), timeout).catch(() => {});
}

function waitFor(predicate, timeout) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    (function check() {
      try {
        if (predicate()) return resolve(true);
      } catch (e) {}
      if (performance.now() - start > timeout) return reject(new Error('等待条件超时'));
      setTimeout(check, 250);
    })();
  });
}

function sleepRandom(minMs, maxMs) {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(r => setTimeout(r, delay));
}

function setNativeValue(el, value) {
  const lastValue = el.value;
  el.value = value;
  const event = new Event('input', { bubbles: true });
  // React 兼容: 修改 value tracker
  const tracker = el._valueTracker;
  if (tracker) tracker.setValue(lastValue);
  el.dispatchEvent(event);
}

// ================= 悬浮球批处理逻辑 =================
let fbState = {
  queue: [],
  isRunning: false,
  isPaused: false,
  currentIndex: 0,
  genTimeout: 15000,
  navTimeout: 20000
};

function injectFloatingBall() {
  const ball = document.createElement('div');
  ball.id = 'grokBatchBall';
  ball.style.cssText = 'position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#FFE135;display:flex;align-items:center;justify-content:center;cursor:move;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.4);user-select:none;transition:transform 0.15s;pointer-events:auto;';
  ball.innerHTML = `<svg width="40" height="40" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none;"><ellipse cx="32" cy="38" rx="24" ry="20" fill="#F4A460"/><ellipse cx="24" cy="28" rx="8" ry="10" fill="#F4A460"/><ellipse cx="40" cy="28" rx="8" ry="10" fill="#F4A460"/><circle cx="26" cy="36" r="2.5" fill="#333"/><circle cx="38" cy="36" r="2.5" fill="#333"/><ellipse cx="32" cy="42" rx="3" ry="2" fill="#333"/><path d="M29 42 Q32 45 35 42" stroke="#333" stroke-width="1.5" fill="none"/></svg>`;
  document.documentElement.appendChild(ball);
  makeDraggable(ball);

  const panel = document.createElement('div');
  panel.id = 'grokBatchPanel';
  panel.style.cssText = 'position:fixed;right:20px;bottom:90px;width:340px;max-height:70vh;overflow:auto;background:#2a2a2a;color:#fff;border:2px solid #FFE135;border-radius:12px;padding:12px;font-size:13px;z-index:9999;font-family:sans-serif;display:none;box-shadow:0 6px 20px rgba(0,0,0,.5);pointer-events:auto;';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong style="font-size:16px;color:#FFE135;">🐕 Grok 批量助手</strong>
      <button id="grokClosePanel" style="background:#444;border:none;color:#fff;font-size:20px;cursor:pointer;border-radius:4px;width:28px;height:28px;line-height:20px;">×</button>
    </div>
    <label style="display:block;margin-top:8px;color:#FFE135;font-weight:bold;">选择图片</label>
    <input id="grokFiles" type="file" multiple accept="image/*" style="display:block;margin-top:4px;width:100%;padding:4px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:4px;" />
    <div id="grokFileCount" style="font-size:11px;color:#888;margin-top:2px;">已选择: 0 张图片</div>
    <label style="display:block;margin-top:10px;color:#FFE135;font-weight:bold;">提示词 (一行一条)</label>
    <textarea id="grokPrompts" placeholder="每行对应一张图片..." style="width:100%;height:100px;margin-top:4px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:4px;padding:6px;resize:vertical;font-size:12px;"></textarea>
    <div id="grokPromptCount" style="font-size:11px;color:#888;margin-top:2px;">提示词: 0 条</div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:12px;">
      <label style="color:#ddd;" title="生成视频等待时间">生成等待 <input id="grokGenTimeout" type="number" value="5" min="3" style="width:50px;padding:2px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:3px;" />秒</label>
      <label style="color:#ddd;" title="页面跳转等待时间">页面跳转 <input id="grokNavTimeout" type="number" value="7" min="3" style="width:50px;padding:2px;background:#1a1a1a;color:#fff;border:1px solid #555;border-radius:3px;" />秒</label>
      <label style="color:#ddd;"><input id="grokAutoScroll" type="checkbox" checked /> 自动滚动</label>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      <button id="grokStart" style="flex:1;background:#FFE135;color:#000;border:none;padding:10px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:13px;">开始</button>
      <button id="grokPause" style="flex:1;background:#FF9800;color:#fff;border:none;padding:10px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:13px;" disabled>暂停</button>
      <button id="grokResume" style="flex:1;background:#4CAF50;color:#fff;border:none;padding:10px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:13px;" disabled>继续</button>
      <button id="grokStop" style="flex:1;background:#F44336;color:#fff;border:none;padding:10px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:13px;" disabled>停止</button>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px;">
      <button id="grokClear" style="flex:1;background:#607D8B;color:#fff;border:none;padding:8px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:12px;">清空全部</button>
      <button id="grokClearLog" style="flex:1;background:#78909C;color:#fff;border:none;padding:8px;border-radius:6px;font-weight:bold;cursor:pointer;font-size:12px;">清空日志</button>
    </div>
    <div style="margin-top:10px;font-weight:bold;color:#FFE135;font-size:14px;" id="grokStatus">待命</div>
    <progress id="grokProgress" value="0" max="0" style="width:100%;height:14px;margin-top:6px;border-radius:7px;"></progress>
    <pre id="grokLog" style="background:#000;color:#0f0;padding:6px;height:120px;overflow:auto;white-space:pre-wrap;margin-top:10px;border:1px solid #333;border-radius:6px;font-size:11px;"></pre>
  `;
  document.documentElement.appendChild(panel);

  makeDraggable(panel); // 面板也可拖拽

  // 加载保存的配置
  loadSettings();

  ball.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  panel.querySelector('#grokClosePanel').addEventListener('click', () => panel.style.display = 'none');
  panel.querySelector('#grokStart').addEventListener('click', startBatchFromPanel);
  panel.querySelector('#grokPause').addEventListener('click', () => pauseBatch());
  panel.querySelector('#grokResume').addEventListener('click', () => resumeBatch());
  panel.querySelector('#grokStop').addEventListener('click', () => stopBatch());
  panel.querySelector('#grokClear').addEventListener('click', () => clearAll());
  panel.querySelector('#grokClearLog').addEventListener('click', () => clearLog());
  
  // 统计更新
  panel.querySelector('#grokFiles').addEventListener('change', updateCounts);
  panel.querySelector('#grokPrompts').addEventListener('input', updateCounts);
}

function panelLog(msg) {
  const logEl = document.getElementById('grokLog');
  if (!logEl) return;
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function updatePanelStatus() {
  const stEl = document.getElementById('grokStatus');
  const progEl = document.getElementById('grokProgress');
  if (!stEl || !progEl) return;
  stEl.textContent = fbState.isRunning ? (fbState.isPaused ? '暂停' : `运行中 (${fbState.currentIndex}/${fbState.queue.length})`) : '待命';
  progEl.max = fbState.queue.length;
  progEl.value = fbState.currentIndex;
}

function updateCounts() {
  const filesEl = document.getElementById('grokFiles');
  const promptsEl = document.getElementById('grokPrompts');
  const fileCountEl = document.getElementById('grokFileCount');
  const promptCountEl = document.getElementById('grokPromptCount');
  
  const fileCount = filesEl ? filesEl.files.length : 0;
  const lines = promptsEl ? promptsEl.value.split(/\r?\n/).filter(l => l.trim().length > 0) : [];
  const promptCount = lines.length;
  
  if (fileCountEl) {
    fileCountEl.textContent = `已选择: ${fileCount} 张图片`;
    fileCountEl.style.color = fileCount > 0 ? '#4CAF50' : '#888';
  }
  if (promptCountEl) {
    let text = `提示词: ${promptCount} 条`;
    let color = '#888';
    if (fileCount > 0 && promptCount > 0) {
      if (fileCount === promptCount) {
        text += ' ✅ 完美匹配';
        color = '#4CAF50';
      } else if (promptCount < fileCount) {
        text += ` ⚠️ 缺少 ${fileCount - promptCount} 条`;
        color = '#FF9800';
      } else {
        text += ` ⚠️ 多了 ${promptCount - fileCount} 条`;
        color = '#FF9800';
      }
    }
    promptCountEl.textContent = text;
    promptCountEl.style.color = color;
  }
}

function startBatchFromPanel() {
  if (fbState.isRunning) return;
  const filesEl = document.getElementById('grokFiles');
  const promptsEl = document.getElementById('grokPrompts');
  const genT = document.getElementById('grokGenTimeout');
  const navT = document.getElementById('grokNavTimeout');
  const autoScrollEl = document.getElementById('grokAutoScroll');
  
  fbState.genTimeout = parseInt(genT.value, 10) * 1000;
  fbState.navTimeout = parseInt(navT.value, 10) * 1000;
  
  // 保存配置
  saveSettings({
    genTimeout: genT.value,
    navTimeout: navT.value,
    autoScroll: autoScrollEl.checked
  });
  
  const lines = promptsEl.value.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  fbState.queue = Array.from(filesEl.files).map((f, i) => ({ file: f, prompt: lines[i] || '' }));
  if (!fbState.queue.length) { panelLog('无文件'); return; }
  fbState.isRunning = true;
  fbState.isPaused = false;
  fbState.currentIndex = 0;
  document.getElementById('grokStart').disabled = true;
  document.getElementById('grokPause').disabled = false;
  document.getElementById('grokStop').disabled = false;
  document.getElementById('grokResume').disabled = true;
  panelLog(`开始批处理，总数 ${fbState.queue.length}`);
  runBatchLoop();
}

async function runBatchLoop() {
  while (fbState.isRunning && fbState.currentIndex < fbState.queue.length) {
    if (fbState.isPaused) { await sleepLocal(500); continue; }
    const item = fbState.queue[fbState.currentIndex];
    const currentIdx = fbState.currentIndex + 1; // 1-based index
    panelLog(`处理第 ${currentIdx} 张: ${item.file.name}`);
    try {
      const fileForUpload = await compressFileToWebp(item.file, 0.9);
      const base64 = await fileToBase64(fileForUpload);
      await processOne({
        fileName: fileForUpload.name,
        mimeType: fileForUpload.type,
        base64,
        prompt: item.prompt,
        index: currentIdx, // 传递索引以便日志显示
        genTimeout: fbState.genTimeout,
        navTimeout: fbState.navTimeout,
        autoScroll: document.getElementById('grokAutoScroll').checked
      });
      panelLog(`完成第 ${currentIdx}`);
    } catch (e) {
      if (e.message.includes('被审核拦截')) {
        panelLog(`第 ${currentIdx} 张被审核拦截，已跳过（提示词第 ${currentIdx} 条对应保留）`);
      } else {
        panelLog(`失败第 ${currentIdx}: ${e.message}`);
      }
    }
    fbState.currentIndex++;
    updatePanelStatus();
    await sleepLocal(2000); // 固定 2 秒间隔，避免提交混乱
  }
  if (fbState.currentIndex >= fbState.queue.length) {
    panelLog('批处理结束');
    playSuccessSound();
    fbState.isRunning = false;
    document.getElementById('grokStart').disabled = false;
    document.getElementById('grokPause').disabled = true;
    document.getElementById('grokResume').disabled = true;
    document.getElementById('grokStop').disabled = true;
    updatePanelStatus();
  }
}

async function compressFileToWebp(file, quality = 0.9) {
  try {
    if (file.type === 'image/webp') return file;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) throw new Error('toBlob 失败');
    const newName = file.name.replace(/\.[^.]+$/, '.webp');
    return new File([blob], newName, { type: 'image/webp' });
  } catch (e) {
    panelLog(`WebP压缩失败，使用原图: ${file.name}`);
    return file;
  }
}

function pauseBatch() {
  fbState.isPaused = true;
  document.getElementById('grokPause').disabled = true;
  document.getElementById('grokResume').disabled = false;
  panelLog('暂停');
  updatePanelStatus();
}
function resumeBatch() {
  fbState.isPaused = false;
  document.getElementById('grokPause').disabled = false;
  document.getElementById('grokResume').disabled = true;
  panelLog('继续');
  updatePanelStatus();
}
function stopBatch() {
  fbState.isRunning = false;
  fbState.isPaused = false;
  panelLog('停止');
  document.getElementById('grokStart').disabled = false;
  document.getElementById('grokPause').disabled = true;
  document.getElementById('grokResume').disabled = true;
  document.getElementById('grokStop').disabled = true;
  updatePanelStatus();
}

function clearAll() {
  const filesEl = document.getElementById('grokFiles');
  const promptsEl = document.getElementById('grokPrompts');
  const logEl = document.getElementById('grokLog');
  filesEl.value = '';
  promptsEl.value = '';
  logEl.textContent = '';
  fbState.queue = [];
  fbState.currentIndex = 0;
  updatePanelStatus();
  panelLog('已清空全部');
}

function clearLog() {
  const logEl = document.getElementById('grokLog');
  logEl.textContent = '';
  panelLog('日志已清空');
}

function saveSettings(settings) {
  try {
    localStorage.setItem('grokBatchSettings', JSON.stringify(settings));
  } catch (e) {
    logLocal('保存配置失败', e);
  }
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('grokBatchSettings');
    if (saved) {
      const settings = JSON.parse(saved);
      const genT = document.getElementById('grokGenTimeout');
      const navT = document.getElementById('grokNavTimeout');
      const autoScrollEl = document.getElementById('grokAutoScroll');
      if (genT && settings.genTimeout) genT.value = settings.genTimeout;
      if (navT && settings.navTimeout) navT.value = settings.navTimeout;
      if (autoScrollEl && typeof settings.autoScroll === 'boolean') autoScrollEl.checked = settings.autoScroll;
    }
  } catch (e) {
    logLocal('加载配置失败', e);
  }
}

function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 金币声音符
    let time = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
      osc.start(time);
      osc.stop(time + 0.3);
      time += 0.1;
    });
  } catch (e) {
    logLocal('播放音效失败', e);
  }
}

function sleepLocal(ms) { return new Promise(r => setTimeout(r, ms)); }
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function makeDraggable(el) {
  let isDragging = false, startX, startY, initialX, initialY;
  el.addEventListener('mousedown', e => {
    // 排除可编辑元素：input, textarea, button 以及它们的子元素
    const target = e.target;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || 
        target.closest('button') || target.closest('input') || target.closest('textarea')) {
      return;
    }
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    initialX = rect.left;
    initialY = rect.top;
    el.style.transition = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = (initialX + dx) + 'px';
    el.style.top = (initialY + dy) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      el.style.transition = 'transform 0.15s';
    }
  });
}
