import http from 'node:http';

export class CdpClient {
  constructor(options = {}) {
    this.port = options.port || 9222;
    this.host = options.host || 'localhost';
  }

  static async httpJson(method, host, port, path) {
    const candidateHosts = ['localhost', '::1', '127.0.0.1'];
    if (host && !candidateHosts.includes(host)) candidateHosts.unshift(host);

    let lastErr = null;
    for (const h of candidateHosts) {
      try {
        return await new Promise((resolve, reject) => {
          const req = http.request({
            host: h,
            port,
            path,
            method,
            headers: {
              'Host': `localhost:${port}`,
              'Origin': `http://localhost:${port}`
            },
            timeout: 3000
          }, (res) => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  resolve(JSON.parse(raw));
                } catch {
                  resolve(raw);
                }
              } else {
                reject(new Error(`CDP HTTP status ${res.statusCode}: ${raw}`));
              }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => req.destroy(new Error('CDP connection timeout')));
          req.end();
        });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error(`Unable to connect to CDP on port ${port}`);
  }

  async testConnection() {
    const startTime = Date.now();
    try {
      const version = await CdpClient.httpJson('GET', this.host, this.port, '/json/version');
      const latencyMs = Date.now() - startTime;
      return {
        connected: true,
        latencyMs,
        browser: version['Browser'] || 'Unknown Browser',
        protocolVersion: version['Protocol-Version'],
        userAgent: version['User-Agent'],
        webSocketDebuggerUrl: version['webSocketDebuggerUrl']
      };
    } catch (err) {
      return {
        connected: false,
        latencyMs: Date.now() - startTime,
        error: err.message
      };
    }
  }

  async listTabs() {
    try {
      const tabs = await CdpClient.httpJson('GET', this.host, this.port, '/json/list');
      return (tabs || []).filter(t => t.type === 'page');
    } catch {
      return [];
    }
  }

  async createTab(initialUrl = 'about:blank') {
    const targetUrl = `/json/new?${encodeURIComponent(initialUrl)}`;
    const tabInfo = await CdpClient.httpJson('PUT', this.host, this.port, targetUrl);
    return tabInfo;
  }

  async closeTab(targetId) {
    try {
      await CdpClient.httpJson('PUT', this.host, this.port, `/json/close/${targetId}`);
      return true;
    } catch {
      return false;
    }
  }

  async activateTab(targetId) {
    try {
      await CdpClient.httpJson('PUT', this.host, this.port, `/json/activate/${targetId}`);
      return true;
    } catch {
      return false;
    }
  }

  createSession(webSocketUrl) {
    let wsUrl = webSocketUrl;
    if (wsUrl && !wsUrl.includes(`:${this.port}`)) {
      wsUrl = wsUrl.replace(/^ws:\/\/([^/:]+)(\/.*)$/, `ws://$1:${this.port}$2`);
    }
    return new CdpSession(wsUrl, this.port);
  }
}

export class CdpSession {
  constructor(webSocketUrl, port = 9222) {
    this.wsUrl = webSocketUrl;
    this.port = port;
    this.ws = null;
    this.nextId = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
    this.connected = false;
  }

  async connect() {
    if (this.connected && this.ws) return;

    // Try primary wsUrl, and if that fails, try candidate loopbacks
    const candidateUrls = [this.wsUrl];
    if (this.wsUrl.includes('localhost')) {
      candidateUrls.push(this.wsUrl.replace('localhost', '[::1]'));
      candidateUrls.push(this.wsUrl.replace('localhost', '127.0.0.1'));
    } else if (this.wsUrl.includes('127.0.0.1')) {
      candidateUrls.push(this.wsUrl.replace('127.0.0.1', 'localhost'));
      candidateUrls.push(this.wsUrl.replace('127.0.0.1', '[::1]'));
    }

    let lastErr = null;
    for (const url of candidateUrls) {
      try {
        await new Promise((resolve, reject) => {
          let socket;
          try {
            socket = new WebSocket(url);
          } catch (e) {
            return reject(e);
          }

          socket.onopen = () => {
            this.ws = socket;
            this.wsUrl = url;
            this.connected = true;
            resolve();
          };

          socket.onerror = (err) => {
            if (!this.connected) reject(err);
          };

          socket.onclose = () => {
            this.connected = false;
          };

          socket.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.id && this.callbacks.has(msg.id)) {
                const { resolve: resCb, reject: rejCb } = this.callbacks.get(msg.id);
                this.callbacks.delete(msg.id);
                if (msg.error) {
                  rejCb(new Error(msg.error.message || 'CDP Error'));
                } else {
                  resCb(msg.result);
                }
              } else if (msg.method) {
                const listeners = this.eventListeners.get(msg.method) || [];
                for (const l of listeners) l(msg.params);
              }
            } catch {}
          };
        });
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('WebSocket connection failed to all loopback targets');
  }

  send(method, params = {}) {
    if (!this.connected || !this.ws) {
      return Promise.reject(new Error('CDP Session is not connected'));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.callbacks.delete(id);
        reject(new Error(`CDP command ${method} timed out`));
      }, 30000);

      this.callbacks.set(id, {
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
        reject: (err) => { clearTimeout(timeout); reject(err); }
      });

      this.ws.send(payload);
    });
  }

  on(event, handler) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(handler);
  }

  async initializePage() {
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Runtime.enable');
    try {
      await this.send('Page.bringToFront');
    } catch {}
    try {
      await this.send('Accessibility.enable');
    } catch {}
  }

  async navigate(url, timeoutMs = 20000) {
    return new Promise(async (resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ loaded: false, timeout: true });
        }
      }, timeoutMs);

      const onLoaded = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ loaded: true });
        }
      };

      this.on('Page.loadEventFired', onLoaded);
      this.on('Page.domContentEventFired', onLoaded);

      try {
        await this.send('Page.navigate', { url });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  }

  async captureScreenshot(quality = 65) {
    try {
      const res = await this.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality,
        fromSurface: true
      });
      return res.data; // Base64 encoded string
    } catch (err) {
      return null;
    }
  }

  async inspectAccessibilityTree() {
    try {
      const res = await this.send('Accessibility.getFullAXTree', { depth: 3 });
      return res.nodes || [];
    } catch {
      return [];
    }
  }

  async extractContent() {
    const expr = `
      (() => {
        const title = document.title || '';
        const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({
          tag: h.tagName.toLowerCase(),
          text: (h.innerText || '').trim()
        })).filter(h => h.text.length > 0);

        const meta = {};
        document.querySelectorAll('meta').forEach(m => {
          const name = m.getAttribute('name') || m.getAttribute('property');
          const val = m.getAttribute('content');
          if (name && val) meta[name] = val;
        });

        // Collect links with visible anchor text
        const links = [];
        const seenUrls = new Set();
        document.querySelectorAll('a[href]').forEach(a => {
          try {
            const href = a.href;
            if (href && !seenUrls.has(href) && href.startsWith('http')) {
              seenUrls.add(href);
              links.push({
                href,
                text: (a.innerText || '').trim().slice(0, 150)
              });
            }
          } catch {}
        });

        // Main readable text body
        const bodyClone = document.body ? document.body.cloneNode(true) : null;
        if (bodyClone) {
          ['script', 'style', 'svg', 'noscript', 'canvas', 'iframe', 'nav', 'footer'].forEach(tag => {
            bodyClone.querySelectorAll(tag).forEach(el => el.remove());
          });
        }
        const textContent = bodyClone ? (bodyClone.innerText || bodyClone.textContent || '').replace(/\\s+/g, ' ').trim() : '';

        return {
          title,
          headings,
          meta,
          links: links.slice(0, 80),
          textContent: textContent.slice(0, 100000),
          wordCount: textContent ? textContent.split(/\\s+/).length : 0
        };
      })()
    `;

    try {
      const evalRes = await this.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true
      });
      return evalRes?.result?.value || null;
    } catch (err) {
      return null;
    }
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.connected = false;
      this.ws = null;
    }
  }
}
