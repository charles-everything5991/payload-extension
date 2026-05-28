(function() {
  let encryptionKey = '';

  // Decryption setup
  const ALG = 'AES-GCM';
  const IV_BYTES = 16;
  const TAG_BITS = 128;
  const AAD = new TextEncoder().encode('liga-http-payload');

  function sanitizeKey(rawKey) {
    return rawKey
      .replace(/["'`‘’“”]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  async function importKey(rawKey) {
    const cleanKey = sanitizeKey(rawKey);
    if (!cleanKey || cleanKey.length < 32) {
      throw new Error('Key too short');
    }
    const keyBytes = new TextEncoder().encode(cleanKey.slice(0, 32));
    return await crypto.subtle.importKey(
      'raw',
      keyBytes,
      ALG,
      false,
      ['encrypt', 'decrypt']
    );
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function decryptJson(payloadB64, rawKey) {
    const key = await importKey(rawKey);
    const raw = base64ToBytes(payloadB64);
    if (raw.length < IV_BYTES + 16) {
      throw new Error('Payload too short');
    }
    const iv = raw.subarray(0, IV_BYTES);
    const ctAndTag = raw.subarray(IV_BYTES);
    const plaintext = await crypto.subtle.decrypt(
      { name: ALG, iv, additionalData: AAD, tagLength: TAG_BITS },
      key,
      ctAndTag
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function isEncryptedEnvelope(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof value.payload !== 'string'
    ) {
      return false;
    }
    return value.payload.length >= 44;
  }

  // Listen for key updates from content script
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'LIGA_DECRYPTER_SET_KEY') {
      encryptionKey = event.data.key || '';
    }
  });

  async function processPayload(url, method, status, reqBodyStr, resBodyStr) {
    // Ensure url is always a string (handles URL objects)
    const urlStr = typeof url === 'string' ? url : (url && url.href ? url.href : String(url || ''));

    // Exclude static assets, developer tools, and tracking scripts
    const isAsset = urlStr.includes('.js') || 
                    urlStr.includes('.css') || 
                    urlStr.includes('.png') || 
                    urlStr.includes('.svg') || 
                    urlStr.includes('.jpg') || 
                    urlStr.includes('hot-update.json') || 
                    urlStr.includes('sentry') ||
                    urlStr.includes('beacon');
    if (isAsset) return;

    const entry = {
      id: 'req-' + Date.now() + '-' + Math.random(),
      url: urlStr,
      method,
      status,
      time: new Date().toLocaleTimeString(),
      rawRequest: null,
      decryptedRequest: null,
      rawResponse: null,
      decryptedResponse: null
    };

    // Parse request
    if (reqBodyStr) {
      try {
        const parsed = JSON.parse(reqBodyStr);
        entry.rawRequest = parsed;
        if (isEncryptedEnvelope(parsed)) {
          if (encryptionKey) {
            try {
              entry.decryptedRequest = await decryptJson(parsed.payload, encryptionKey);
            } catch (err) {
              entry.decryptedRequest = { __error: 'Decryption failed: ' + (err.message || err.name || String(err)) };
            }
          }
        } else {
          entry.decryptedRequest = parsed;
        }
      } catch (e) {
        entry.rawRequest = reqBodyStr;
      }
    }

    // Parse response
    if (resBodyStr) {
      try {
        const parsed = JSON.parse(resBodyStr);
        entry.rawResponse = parsed;
        if (isEncryptedEnvelope(parsed)) {
          if (encryptionKey) {
            try {
              entry.decryptedResponse = await decryptJson(parsed.payload, encryptionKey);
            } catch (err) {
              entry.decryptedResponse = { __error: 'Decryption failed: ' + (err.message || err.name || String(err)) };
            }
          }
        } else {
          entry.decryptedResponse = parsed;
        }
      } catch (e) {
        entry.rawResponse = resBodyStr;
      }
    }

    // Post to content.js
    window.postMessage({
      type: 'LIGA_DECRYPTER_NEW_REQUEST',
      request: entry
    }, '*');
  }

  // --- HOCKING FETCH ---
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    let url = '';
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    } else if (input && typeof input === 'object' && 'href' in input) {
      url = input.href;
    }

    let method = 'GET';
    if (init && init.method) {
      method = init.method;
    } else if (input instanceof Request) {
      method = input.method;
    }

    let reqBody = init && init.body ? init.body : null;

    if (input instanceof Request && !reqBody) {
      try {
        const clone = input.clone();
        reqBody = await clone.text();
      } catch (e) {}
    }

    const response = await originalFetch.apply(this, arguments);

    try {
      const resClone = response.clone();
      const resText = await resClone.text();
      let reqText = typeof reqBody === 'string' ? reqBody : null;
      if (reqBody && (reqBody instanceof Blob || reqBody instanceof ArrayBuffer)) {
        reqText = await new Response(reqBody).text();
      }
      
      processPayload(url, method, response.status, reqText, resText);
    } catch (err) {
      console.error('[Decrypter Hook] Error reading fetch stream:', err);
    }

    return response;
  };

  // --- HOCKING XHR ---
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    this._url = url instanceof URL ? url.href : String(url || '');
    this._requestHeaders = {};
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    this._requestHeaders[header] = value;
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    this._requestBody = body;
    
    this.addEventListener('load', () => {
      let resBody = null;
      try {
        resBody = this.responseText;
      } catch (e) {}
      
      processPayload(this._url, this._method, this.status, this._requestBody, resBody);
    });

    return originalSend.apply(this, arguments);
  };

  console.log('🔓 Liga Network Decrypter hook injected successfully.');
})();
