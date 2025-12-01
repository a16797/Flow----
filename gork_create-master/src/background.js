// 合并版后台：保留默认应答，并新增下载处理
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 下载请求处理
  if (msg && msg.action === 'download' && msg.url) {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename || undefined,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载失败:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId });
      }
    });
    return true; // 异步响应
  }

  // 代理设置处理
  if (msg && msg.action === 'setProxy') {
    setProxySettings(msg.proxy, sendResponse);
    return true; // 异步响应
  }

  // 默认应答
  sendResponse({ ok: true, echo: true });
});

// 设置代理
async function setProxySettings(proxyUrl, sendResponse) {
  try {
    let proxyConfig;

    if (proxyUrl && proxyUrl.trim()) {
      // 解析代理URL
      const proxyMatch = proxyUrl.match(/^(socks5h?):\/\/([^:]+):(\d+)$/);
      if (!proxyMatch) {
        sendResponse({ success: false, error: '代理格式错误，请使用 socks5h://host:port 格式' });
        return;
      }

      const [, scheme, host, port] = proxyMatch;

      proxyConfig = {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme: 'socks5',
            host: host,
            port: parseInt(port, 10)
          }
        }
      };
    } else {
      // 清除代理设置
      proxyConfig = { mode: 'system' };
    }

    chrome.proxy.settings.set(
      { value: proxyConfig, scope: 'regular' },
      () => {
        if (chrome.runtime.lastError) {
          console.error('代理设置失败:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('代理设置成功:', proxyUrl || '已清除代理');
          sendResponse({ success: true, proxy: proxyUrl });
        }
      }
    );
  } catch (error) {
    console.error('代理设置异常:', error);
    sendResponse({ success: false, error: error.message });
  }
}
