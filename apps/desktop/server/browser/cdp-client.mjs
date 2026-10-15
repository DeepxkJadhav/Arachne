import http from 'node:http';

export class CdpClient {
  constructor(options = {}) {
    this.port = options.port || 9222;
    this.host = options.host || '127.0.0.1';
  }

  static async httpGetJson(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 4000 }, (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch (err) {
              reject(new Error(`Failed to parse CDP JSON: ${err.message}`));
            }
          } else {
            reject(new Error(`CDP HTTP status ${res.statusCode}: ${raw}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('CDP connection timeout')));
    });
  }

  async testConnection() {
    const startTime = Date.now();
    try {
      const version = await CdpClient.httpGetJson(`http://${this.host}:${this.port}/json/version`);
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
      const tabs = await CdpClient.httpGetJson(`http://${this.host}:${this.port}/json/list`);
      return (tabs || []).filter(t => t.type === 'page');
    } catch {
      return [];
    }
  }

  async createTab(initialUrl = 'about:blank') {
    const targetUrl = `http://${this.host}:${this.port}/json/new?${encodeURIComponent(initialUrl)}`;
    const tabInfo = await CdpClient.httpGetJson(targetUrl);
    return tabInfo;
  }

  async closeTab(targetId) {
    try {
      const closeUrl = `http://${this.host}:${this.port}/json/close/${targetId}`;
      await new Promise((resolve) => {
        const req = http.get(closeUrl, { timeout: 3000 }, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        });
        req.on('error', resolve);
      });
      return true;
    } catch {
      return false;
    }
  }

  createSession(webSocketUrl) {
    return new CdpSession(webSocketUrl);
  }
}

export class CdpSession {
  constructor(webSocketUrl) {
    this.wsUrl = webSocketUrl;
    this.ws = null;
    this.nextId = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
    this.connected = false;
  }

  async connect() {
    if (this.connected && this.ws) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err) {
        return reject(err);
      }

      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      };

      this.ws.onerror = (err) => {
        if (!this.connected) reject(err);
      };

      this.ws.onclose = () => {
        this.connected = false;
      };

      this.ws.onmessage = (event) => {
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
        const bodyClone = document.body.cloneNode(true);
        ['script', 'style', 'svg', 'noscript', 'canvas', 'iframe'].forEach(tag => {
          bodyClone.querySelectorAll(tag).forEach(el => el.remove());
        });
        const textContent = (bodyClone.innerText || bodyClone.textContent || '').replace(/\\s+/g, ' ').trim();

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
