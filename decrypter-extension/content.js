(function() {
  // 1. Inject inject.js into webpage
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  s.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(s);

  let encryptionKey = 'd427e682c1a848a6a5e5f0178759b137';
  let requests = [];
  let selectedRequest = null;
  let searchQuery = '';

  // Synchronize key with inject.js
  function syncKey() {
    chrome.storage.local.get(['encryption_key'], (result) => {
      if (result.encryption_key) {
        encryptionKey = result.encryption_key;
        window.postMessage({ type: 'LIGA_DECRYPTER_SET_KEY', key: encryptionKey }, '*');
        updateKeyIndicator();
      }
    });
  }

  // Load key initially
  setTimeout(syncKey, 500);

  // Watch storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.encryption_key) {
      encryptionKey = changes.encryption_key.newValue || '';
      window.postMessage({ type: 'LIGA_DECRYPTER_SET_KEY', key: encryptionKey }, '*');
      updateKeyIndicator();
    }
  });

  // Wrap UI creation to wait for document.body to be ready (since content script runs at document_start)
  function initializeUI() {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', initializeUI, { once: true });
      return;
    }

    if (document.getElementById('liga-decrypter-shadow-host')) return;

    // 2. Create Shadow Host for isolated styles
    const host = document.createElement('div');
    host.id = 'liga-decrypter-shadow-host';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });

    // 3. Inject styles into shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      /* Floating Action Button */
      .fab {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 48px;
        height: 48px;
        border-radius: 24px;
        background: linear-gradient(135deg, #89b4fa, #b4befe);
        color: #11111b;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 20px;
        z-index: 999999;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .fab:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      }
      
      /* Drawer Panel */
      .drawer {
        position: fixed;
        top: 0;
        right: -550px;
        width: 520px;
        height: 100vh;
        background: rgba(30, 30, 46, 0.95);
        backdrop-filter: blur(12px);
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.3);
        z-index: 999998;
        transition: right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #cdd6f4;
        border-left: 1px solid #313244;
        box-sizing: border-box;
      }
      .drawer.open {
        right: 0;
      }

      /* Top bar */
      .header {
        padding: 16px;
        border-bottom: 1px solid #313244;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(24, 24, 37, 0.5);
      }
      .title-group {
        display: flex;
        flex-direction: column;
      }
      .title {
        font-size: 15px;
        font-weight: bold;
        color: #89b4fa;
      }
      .key-indicator {
        font-size: 11px;
        color: #a6adc8;
        margin-top: 2px;
      }
      .key-indicator.configured {
        color: #a6e3a1;
      }
      .close-btn {
        background: transparent;
        border: none;
        color: #a6adc8;
        cursor: pointer;
        font-size: 20px;
        padding: 4px;
        line-height: 1;
      }
      .close-btn:hover {
        color: #f38ba8;
      }

      /* Filter & Controls */
      .controls {
        padding: 12px 16px;
        border-bottom: 1px solid #313244;
        display: flex;
        gap: 8px;
      }
      .search-input {
        flex: 1;
        background: #313244;
        border: 1px solid #45475a;
        color: #cdd6f4;
        padding: 6px 10px;
        border-radius: 4px;
        outline: none;
        font-size: 12px;
      }
      .search-input:focus {
        border-color: #89b4fa;
      }
      .btn-clear {
        background: #f38ba8;
        color: #11111b;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
      }
      .btn-clear:hover {
        background: #f5c2e7;
      }

      /* Split panel */
      .content-area {
        flex: 1;
        display: flex;
        overflow: hidden;
      }
      
      .list-pane {
        width: 200px;
        border-right: 1px solid #313244;
        overflow-y: auto;
        background: rgba(17, 17, 27, 0.3);
      }
      .detail-pane {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
      }
      
      /* Request List Items */
      .list-item {
        padding: 10px 12px;
        border-bottom: 1px solid #313244;
        cursor: pointer;
        font-size: 11px;
        transition: background 0.15s;
      }
      .list-item:hover {
        background: #313244;
      }
      .list-item.selected {
        background: #313244;
        border-left: 3px solid #89b4fa;
      }
      .item-meta {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
      }
      .item-method {
        font-weight: bold;
        color: #89b4fa;
      }
      .item-status {
        font-weight: bold;
      }
      .status-2xx { color: #a6e3a1; }
      .status-error { color: #f38ba8; }
      .item-url {
        word-break: break-all;
        opacity: 0.85;
      }

      /* Details Panel UI */
      .detail-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: #a6adc8;
        font-size: 13px;
        text-align: center;
      }
      .detail-header {
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #313244;
      }
      .detail-url {
        font-weight: bold;
        word-break: break-all;
        font-size: 12px;
        color: #cdd6f4;
      }
      
      .section-title {
        font-weight: bold;
        margin-top: 14px;
        margin-bottom: 6px;
        color: #b4befe;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      pre {
        margin: 0;
        background: #11111b;
        border: 1px solid #313244;
        border-radius: 6px;
        padding: 10px;
        font-family: Consolas, Menlo, Monaco, monospace;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-all;
        overflow-x: auto;
        max-height: 250px;
        color: #a6e3a1;
      }
      .err-pre {
        color: #f38ba8;
      }
    `;
    shadow.appendChild(style);

    // 4. Create floating action button
    const fab = document.createElement('div');
    fab.className = 'fab';
    fab.textContent = '🔓';
    fab.title = 'Open Liga Decrypter';
    shadow.appendChild(fab);

    // 5. Create drawer element
    const drawer = document.createElement('div');
    drawer.className = 'drawer';
    drawer.innerHTML = `
      <div class="header">
        <div class="title-group">
          <span class="title">🔓 Liga Decrypter Console</span>
          <span class="key-indicator" id="drawer-key-indicator">🔴 Key not configured</span>
        </div>
        <button class="close-btn" id="drawer-close">&times;</button>
      </div>
      <div class="controls">
        <input type="text" class="search-input" id="drawer-search" placeholder="Filter endpoints..." />
        <button class="btn-clear" id="drawer-clear">Clear</button>
      </div>
      <div class="content-area">
        <div class="list-pane" id="drawer-list"></div>
        <div class="detail-pane" id="drawer-detail">
          <div class="detail-placeholder">Select an API request to view decrypted payloads</div>
        </div>
      </div>
    `;
    shadow.appendChild(drawer);

    // Cache elements
    const drawerList = shadow.getElementById('drawer-list');
    const drawerDetail = shadow.getElementById('drawer-detail');
    const drawerSearch = shadow.getElementById('drawer-search');
    const drawerClear = shadow.getElementById('drawer-clear');
    const keyIndicator = shadow.getElementById('drawer-key-indicator');

    // Toggle drawer
    fab.addEventListener('click', () => {
      drawer.classList.add('open');
    });

    shadow.getElementById('drawer-close').addEventListener('click', () => {
      drawer.classList.remove('open');
    });

    // Search filter
    drawerSearch.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderList();
    });

    // Clear list
    drawerClear.addEventListener('click', () => {
      requests = [];
      selectedRequest = null;
      renderList();
      renderDetails(null);
    });

    function updateKeyIndicator() {
      if (encryptionKey && encryptionKey.trim().length >= 32) {
        keyIndicator.textContent = '🟢 Key Configured';
        keyIndicator.className = 'key-indicator configured';
      } else {
        keyIndicator.textContent = '🔴 Key not configured';
        keyIndicator.className = 'key-indicator';
      }
    }

    // Render the list of captured requests in sidebar
    function renderList() {
      drawerList.innerHTML = '';
      const filtered = requests.filter(r => r.url.toLowerCase().includes(searchQuery));

      filtered.forEach((req) => {
        const item = document.createElement('div');
        item.className = 'list-item' + (selectedRequest && selectedRequest.id === req.id ? ' selected' : '');
        
        const isError = req.status >= 400;
        const statusClass = isError ? 'status-error' : 'status-2xx';

        let displayUrl = req.url;
        try {
          const parsed = new URL(req.url, window.location.origin);
          displayUrl = parsed.pathname + parsed.search;
        } catch (e) {}

        item.innerHTML = `
          <div class="item-meta">
            <span class="item-method">${req.method}</span>
            <span class="item-status ${statusClass}">${req.status}</span>
          </div>
          <div class="item-url">${displayUrl}</div>
        `;

        item.addEventListener('click', () => {
          selectedRequest = req;
          renderList();
          renderDetails(req);
        });

        drawerList.appendChild(item);
      });
    }

    // Render details panel
    function renderDetails(req) {
      if (!req) {
        drawerDetail.innerHTML = `<div class="detail-placeholder">Select an API request to view decrypted payloads</div>`;
        return;
      }

      const isError = req.status >= 400;
      const statusClass = isError ? 'status-error' : 'status-2xx';

      // Format request display
      let reqHtml = '';
      if (req.decryptedRequest) {
        const isDecryptErr = req.decryptedRequest.__error;
        reqHtml = `<pre class="${isDecryptErr ? 'err-pre' : ''}">${JSON.stringify(req.decryptedRequest, null, 2)}</pre>`;
      } else {
        reqHtml = `<pre>No request body payload</pre>`;
      }

      // Format response display
      let resHtml = '';
      if (req.decryptedResponse) {
        const isDecryptErr = req.decryptedResponse.__error;
        resHtml = `<pre class="${isDecryptErr ? 'err-pre' : ''}">${JSON.stringify(req.decryptedResponse, null, 2)}</pre>`;
      } else {
        resHtml = `<pre>No response payload</pre>`;
      }

      drawerDetail.innerHTML = `
        <div class="detail-header">
          <div class="detail-url">[${req.method}] ${req.url}</div>
          <div style="font-size: 11px; margin-top: 4px; color: #a6adc8;">
            Status: <span class="${statusClass}">${req.status}</span> | Time: ${req.time}
          </div>
        </div>
        
        <div class="section-title">Decrypted Request Body</div>
        ${reqHtml}
        
        <div class="section-title">Decrypted Response Body</div>
        ${resHtml}
      `;
    }

    // Listen to message from inject.js
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'LIGA_DECRYPTER_NEW_REQUEST') {
        const req = event.data.request;
        requests.unshift(req);
        if (requests.length > 100) {
          requests.pop();
        }
        renderList();
        
        // Auto-update details if current request is selected
        if (selectedRequest && selectedRequest.id === req.id) {
          renderDetails(req);
        }
      }
    });

    // Sync initially
    updateKeyIndicator();
  }

  // Trigger UI building safely when body is available
  initializeUI();
})();
