const fileInput = document.getElementById('fileInput');
const promptsEl = document.getElementById('prompts');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const progressEl = document.getElementById('progress');
const exportLogBtn = document.getElementById('exportLogBtn');
const genTimeoutEl = document.getElementById('genTimeout');
const navTimeoutEl = document.getElementById('navTimeout');
const autoScrollEl = document.getElementById('autoScroll');
const openDownloaderBtn = document.getElementById('openDownloaderBtn');
const proxyInput = document.getElementById('proxyInput');
const setProxyBtn = document.getElementById('setProxyBtn');
const clearProxyBtn = document.getElementById('clearProxyBtn');
const proxyStatus = document.getElementById('proxyStatus');

let currentTabId = null;
let isPaused = false;
let queue = [];
let logs = [];

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logs.push(line);
  logEl.textContent = logs.slice(-300).join('\n');
}

function buildQueue() {
  const files = Array.from(fileInput.files);
  const lines = promptsEl.value.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  queue = files.map((f, idx) => ({
    id: idx + 1,
    file: f,
    prompt: lines[idx] || '',
    status: 'pending'
  }));
  progressEl.max = queue.length;
  progressEl.value = 0;
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImageToWebp(file, quality = 0.9) {
  try {
    // 跳过已为 WebP 的文件
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
    log(`WebP压缩失败，使用原图: ${file.name}`);
    return file;
  }
}

async function compressFilesSequentially(files) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!/^image\//.test(f.type)) { out.push(f); continue; }
    log(`压缩中 (${i + 1}/${files.length})：${f.name}`);
    const c = await compressImageToWebp(f, 0.9);
    out.push(c);
  }
  return out;
}

async function startProcess() {
  if (!fileInput.files.length) { alert('请选择图片'); return; }
  const rawFiles = Array.from(fileInput.files);
  log(`开始WebP压缩，共 ${rawFiles.length} 张图片...`);
  const compressedFiles = await compressFilesSequentially(rawFiles);
  const lines = promptsEl.value.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  queue = compressedFiles.map((f, idx) => ({ id: idx + 1, file: f, prompt: lines[idx] || '', status: 'pending' }));
  if (!queue.length) { alert('队列为空'); return; }
  progressEl.max = queue.length;
  progressEl.value = 0;
  startBtn.disabled = true; pauseBtn.disabled = false; resumeBtn.disabled = true;
  statusEl.textContent = '运行中';
  log(`启动，待处理 ${queue.length} 项`);
  currentTabId = await getActiveTabId();
  loop();
}

async function loop() {
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.status !== 'pending') continue;
    while (isPaused) { await sleep(500); }
    item.status = 'uploading';
    log(`开始第 ${item.id} 张: ${item.file.name}`);
    const base64 = await readFileAsBase64(item.file);
    const payload = {
      type: 'PROCESS_ONE',
      fileName: item.file.name,
      mimeType: item.file.type,
      base64,
      prompt: item.prompt,
      index: item.id,
      genTimeout: parseInt(genTimeoutEl.value, 10) * 1000,
      navTimeout: parseInt(navTimeoutEl.value, 10) * 1000,
      autoScroll: autoScrollEl.checked
    };
    try {
      await sendMessageToTab(currentTabId, payload);
      item.status = 'done';
      progressEl.value = queue.filter(q => q.status === 'done').length;
      log(`完成第 ${item.id}`);
      await sleep(2000); // 固定 2 秒间隔，避免提交混乱
    } catch (e) {
      item.status = 'failed';
      log(`失败第 ${item.id}: ${e.message}`);
    }
  }
  statusEl.textContent = '结束';
  startBtn.disabled = false; pauseBtn.disabled = true; resumeBtn.disabled = true;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getActiveTabId() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0].id));
  });
}

function sendMessageToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, resp => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!resp) {
        reject(new Error('无响应'));
      } else if (resp.ok) {
        resolve(resp);
      } else {
        reject(new Error(resp.error || '未知错误'));
      }
    });
  });
}

startBtn.addEventListener('click', startProcess);
pauseBtn.addEventListener('click', () => { isPaused = true; pauseBtn.disabled = true; resumeBtn.disabled = false; statusEl.textContent = '暂停'; log('暂停'); });
resumeBtn.addEventListener('click', () => { isPaused = false; pauseBtn.disabled = false; resumeBtn.disabled = true; statusEl.textContent = '运行中'; log('继续'); });

exportLogBtn.addEventListener('click', () => {
  const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'grok_batch_log.txt'; a.click();
  URL.revokeObjectURL(url);
});

// 代理设置功能
async function initProxySettings() {
  try {
    const result = await chrome.storage.local.get(['proxySettings']);
    if (result.proxySettings) {
      proxyInput.value = result.proxySettings;
      updateProxyStatus('已设置: ' + result.proxySettings, 'success');
    } else {
      proxyInput.value = 'socks5h://127.0.0.1:10809';
    }
  } catch (error) {
    console.error('初始化代理设置失败:', error);
  }
}

function updateProxyStatus(message, type = 'info') {
  proxyStatus.textContent = message;
  proxyStatus.style.color = type === 'success' ? 'green' : type === 'error' ? 'red' : '#333';
}

async function setProxy(proxyUrl) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'setProxy',
      proxy: proxyUrl
    });

    if (response && response.success) {
      await chrome.storage.local.set({ proxySettings: proxyUrl });
      updateProxyStatus('代理设置成功: ' + proxyUrl, 'success');
      log('代理已设置: ' + proxyUrl);
    } else {
      updateProxyStatus('代理设置失败: ' + (response?.error || '未知错误'), 'error');
      log('代理设置失败: ' + (response?.error || '未知错误'));
    }
  } catch (error) {
    updateProxyStatus('代理设置异常: ' + error.message, 'error');
    log('代理设置异常: ' + error.message);
  }
}

async function clearProxy() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'setProxy',
      proxy: ''
    });

    if (response && response.success) {
      await chrome.storage.local.remove(['proxySettings']);
      updateProxyStatus('代理已清除', 'success');
      log('代理已清除');
    } else {
      updateProxyStatus('清除代理失败: ' + (response?.error || '未知错误'), 'error');
      log('清除代理失败: ' + (response?.error || '未知错误'));
    }
  } catch (error) {
    updateProxyStatus('清除代理异常: ' + error.message, 'error');
    log('清除代理异常: ' + error.message);
  }
}

setProxyBtn.addEventListener('click', () => {
  const proxyUrl = proxyInput.value.trim();
  if (proxyUrl) {
    setProxy(proxyUrl);
  } else {
    updateProxyStatus('请输入代理地址', 'error');
  }
});

clearProxyBtn.addEventListener('click', clearProxy);

// 页面加载时初始化代理设置
document.addEventListener('DOMContentLoaded', initProxySettings);

// 打开视频下载器（合并功能）
openDownloaderBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('grok.com')) {
    alert('请在 grok.com 网站上使用此功能');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { action: 'openDownloader' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      alert('无法连接到页面，请刷新页面后重试');
    } else if (response && (response.success || response.ok)) {
      window.close();
    }
  });
});
