// ================================================================
//  ☬ SHΞN™ Ultimate Bypass Proxy - Full-Featured Enterprise Worker
//  همه‌ی قابلیت‌ها در یک فایل: SSRF, Rate Limit, Circuit Breaker,
//  Cookie Jar, WebSocket/SSE, HTML Rewriter, Cache, Modes, etc.
// ================================================================

const CONFIG = {
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/124.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  ],
  CIRCUIT_BREAKER: { failureThreshold: 5, timeout: 30000 },
  RETRY: { maxAttempts: 3, baseDelay: 1000 },
  RATE_LIMIT: { maxRequestsPerMinute: 60 },
  MAX_TIMEOUT: 30000,
  COOKIE_TTL: 3600,
  CACHE_TTL: 86400 // 24 ساعت
};

// --- ابزارها ---
function isPrivateHost(hostname) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i.test(hostname);
}
function generateId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Circuit Breaker ---
class CircuitBreaker {
  constructor(config) {
    this.failureThreshold = config.failureThreshold;
    this.timeout = config.timeout;
    this.failures = 0;
    this.state = 'closed';
    this.nextAttempt = Date.now();
  }
  isOpen() {
    if (this.state === 'open' && Date.now() > this.nextAttempt) {
      this.state = 'half-open';
      return false;
    }
    return this.state === 'open';
  }
  recordSuccess() { this.failures = 0; this.state = 'closed'; }
  recordFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }
}
const circuitBreakers = new Map();
function getCircuitBreaker(host) {
  if (!circuitBreakers.has(host)) circuitBreakers.set(host, new CircuitBreaker(CONFIG.CIRCUIT_BREAKER));
  return circuitBreakers.get(host);
}

// --- Rate Limiting (با Cache API) ---
async function checkRateLimit(clientIp) {
  const cache = caches.default;
  const key = `rate-limit-${clientIp}`;
  const cached = await cache.match(key);
  let count = cached ? parseInt(await cached.text()) : 0;
  if (count >= CONFIG.RATE_LIMIT.maxRequestsPerMinute) return false;
  count++;
  await cache.put(key, new Response(count.toString(), {
    headers: { 'Cache-Control': 'max-age=60' }
  }));
  return true;
}

// --- Cookie Jar ---
async function getCookieJar(host) {
  const cache = caches.default;
  const key = `cookie-jar-${host}`;
  const cached = await cache.match(key);
  if (cached) return await cached.json();
  return {};
}
async function setCookieJar(host, cookies) {
  const cache = caches.default;
  const key = `cookie-jar-${host}`;
  await cache.put(key, new Response(JSON.stringify(cookies), {
    headers: { 'Cache-Control': `max-age=${CONFIG.COOKIE_TTL}` }
  }));
}
function parseSetCookie(setCookieHeader, existingCookies) {
  const cookies = { ...existingCookies };
  const parts = setCookieHeader.split(';');
  const nameValue = parts[0].trim().split('=');
  if (nameValue.length === 2) {
    const name = nameValue[0];
    const value = nameValue[1];
    const pathPart = parts.find(p => p.trim().toLowerCase().startsWith('path='));
    if (!pathPart || pathPart.split('=')[1].trim() === '/') {
      cookies[name] = value;
    }
  }
  return cookies;
}
function buildCookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// --- HTML Rewriter (بازنویسی لینک‌ها) ---
class LinkRewriter {
  constructor(baseUrl, proxyBase) {
    this.baseUrl = baseUrl;
    this.proxyBase = proxyBase;
  }
  rewriteUrl(url) {
    if (!url) return null;
    if (/^(data:|blob:|javascript:|#)/i.test(url)) return null;
    if (url.includes(this.proxyBase)) return null;
    try {
      const absolute = new URL(url, this.baseUrl);
      if (absolute.protocol === 'http:') absolute.protocol = 'https:';
      return `${this.proxyBase}?url=${encodeURIComponent(absolute.toString())}&mode=iframe&cache=true`;
    } catch (_) { return null; }
  }
  element(element) {
    const tag = element.tagName;
    let attr = null;
    let value = null;
    if (tag === 'a' || tag === 'link') { attr = 'href'; value = element.getAttribute('href'); }
    else if (['img', 'script', 'iframe', 'source', 'track'].includes(tag)) { attr = 'src'; value = element.getAttribute('src'); }
    else if (tag === 'form') { attr = 'action'; value = element.getAttribute('action'); }
    else if (tag === 'meta' && element.getAttribute('http-equiv')?.toLowerCase() === 'refresh') {
      const content = element.getAttribute('content');
      if (content) {
        const match = content.match(/url=(.+)/i);
        if (match) {
          const newUrl = this.rewriteUrl(match[1]);
          if (newUrl) element.setAttribute('content', content.replace(/url=.+/i, `url=${newUrl}`));
        }
      }
      return;
    }
    if (attr && value) {
      const newValue = this.rewriteUrl(value);
      if (newValue) element.setAttribute(attr, newValue);
    }
  }
  comments(comment) { /* ignore */ }
}

// --- WebSocket Handler ---
async function handleWebSocket(request, targetUrl, requestId) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const backendWs = new WebSocket(targetUrl.replace(/^http/, 'ws'));
  backendWs.addEventListener('open', () => {
    server.addEventListener('message', (event) => {
      if (backendWs.readyState === WebSocket.OPEN) backendWs.send(event.data);
    });
  });
  backendWs.addEventListener('message', (event) => server.send(event.data));
  backendWs.addEventListener('close', (event) => server.close(event.code, event.reason));
  server.addEventListener('close', (event) => backendWs.close(event.code, event.reason));
  backendWs.addEventListener('error', () => server.close(1011, 'Backend error'));
  return new Response(null, { status: 101, webSocket: client });
}

// --- SSE Handler ---
async function handleSSE(request, targetUrl, requestId) {
  const headers = new Headers(request.headers);
  ['host', 'connection', 'cf-connecting-ip', 'cf-ray'].forEach(h => headers.delete(h));
  const response = await fetch(targetUrl, {
    method: request.method,
    headers: headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
  });
  const sseHeaders = new Headers(response.headers);
  sseHeaders.set('Access-Control-Allow-Origin', '*');
  sseHeaders.set('Cache-Control', 'no-cache');
  sseHeaders.set('Connection', 'keep-alive');
  sseHeaders.set('X-Proxy-Request-Id', requestId);
  return new Response(response.body, { status: response.status, headers: sseHeaders });
}

// --- MAIN HANDLER ---
export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const requestId = generateId();
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Expose-Headers': 'X-Proxy-Request-Id, X-Proxy-Execution-Time, X-Proxy-Final-Url'
        }
      });
    }

    const url = new URL(request.url);
    const targetUrlStr = url.searchParams.get('url');
    const mode = url.searchParams.get('mode') || 'iframe'; // iframe | raw | trace | headers
    const useCache = url.searchParams.get('cache') === 'true';
    const customTimeout = parseInt(url.searchParams.get('timeout')) || CONFIG.MAX_TIMEOUT;

    if (!targetUrlStr) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
      if (isPrivateHost(targetUrl.hostname)) throw new Error('SSRF Blocked: Private IP detected');
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid or Blocked URL', details: e.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Rate Limiting
    const allowed = await checkRateLimit(clientIp);
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded (60 req/min)' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // WebSocket / SSE
    const upgrade = request.headers.get('upgrade');
    if (upgrade === 'websocket' || targetUrl.protocol === 'ws:' || targetUrl.protocol === 'wss:') {
      return handleWebSocket(request, targetUrl.toString(), requestId);
    }
    if (request.headers.get('content-type')?.includes('text/event-stream') || request.headers.get('accept')?.includes('text/event-stream')) {
      return handleSSE(request, targetUrl.toString(), requestId);
    }

    // Circuit Breaker
    const breaker = getCircuitBreaker(targetUrl.host);
    if (breaker.isOpen()) {
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable (Circuit Breaker Open)' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Cookie Jar
    let cookieJar = await getCookieJar(targetUrl.host);
    const cookieHeader = buildCookieHeader(cookieJar);

    // Cache Check (فقط برای GET و در حالت‌های raw/iframe)
    if (useCache && request.method === 'GET' && (mode === 'raw' || mode === 'iframe')) {
      const cache = caches.default;
      const cached = await cache.match(request);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('X-Proxy-Cache', 'HIT');
        headers.set('X-Proxy-Request-Id', requestId);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(cached.body, { headers });
      }
    }

    // --- درخواست به سرور مقصد (با Retry) ---
    let lastError = null;
    let delay = CONFIG.RETRY.baseDelay;
    for (let attempt = 1; attempt <= CONFIG.RETRY.maxAttempts; attempt++) {
      try {
        // ساخت هدرها
        const headers = new Headers(request.headers);
        headers.set('User-Agent', CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)]);
        // هدرهای سفارشی از طرف کاربر
        const customHeaders = request.headers.get('x-proxy-custom-headers');
        if (customHeaders) {
          try {
            const parsed = JSON.parse(customHeaders);
            Object.keys(parsed).forEach(k => headers.set(k, parsed[k]));
          } catch (_) {}
        }
        // حذف هدرهای مزاحم
        ['host', 'connection', 'cf-connecting-ip', 'cf-worker', 'cf-ray', 'x-forwarded-for', 'x-real-ip'].forEach(h => headers.delete(h));
        // افزودن کوکی‌ها
        if (cookieHeader) headers.set('Cookie', cookieHeader);

        const hasBody = !['GET', 'HEAD'].includes(request.method);
        let bodyData = undefined;
        if (hasBody) {
          if (request.headers.get('content-type')?.includes('multipart/form-data')) {
            bodyData = await request.formData();
          } else {
            bodyData = await request.arrayBuffer();
          }
        }

        // ارسال درخواست با کنترل تایم‌اوت
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), customTimeout);

        const response = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: headers,
          body: bodyData,
          redirect: 'manual',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        breaker.recordSuccess();

        // --- پردازش کوکی‌ها ---
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
          cookieJar = parseSetCookie(setCookie, cookieJar);
          ctx.waitUntil(setCookieJar(targetUrl.host, cookieJar));
        }

        // --- ساخت هدرهای پاسخ ---
        const responseHeaders = new Headers(response.headers);
        // حذف هدرهای امنیتی (برای نمایش در iframe)
        ['x-frame-options', 'content-security-policy', 'x-content-type-options', 'feature-policy', 'permissions-policy'].forEach(h => responseHeaders.delete(h));
        // افزودن هدرهای CORS
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        responseHeaders.set('Access-Control-Expose-Headers', 'X-Proxy-Request-Id, X-Proxy-Execution-Time, X-Proxy-Final-Url');
        responseHeaders.set('X-Proxy-Request-Id', requestId);
        responseHeaders.set('X-Proxy-Execution-Time', `${Date.now() - startTime}ms`);
        responseHeaders.set('X-Proxy-Final-Url', response.url);

        // --- حالت‌های مختلف ---
        if (mode === 'trace') {
          const traceData = {
            success: response.ok,
            originalUrl: targetUrlStr,
            finalUrl: response.url,
            statusCode: response.status,
            contentType: response.headers.get('content-type'),
            executionTimeMs: Date.now() - startTime,
            requestId
          };
          return new Response(JSON.stringify(traceData, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        if (mode === 'headers') {
          const headersObj = {};
          responseHeaders.forEach((v, k) => { headersObj[k] = v; });
          return new Response(JSON.stringify({ headers: headersObj, status: response.status }, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        // --- حالت iframe (بازنویسی HTML) ---
        if (mode === 'iframe') {
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('text/html')) {
            // اگر HTML نبود، همان محتوا را بدون تغییر برگردان (تصاویر، CSS، JS)
            return new Response(response.body, { status: response.status, headers: responseHeaders });
          }

          const html = await response.text();
          const proxyBase = `${url.origin}${url.pathname}`;
          const rewriter = new HTMLRewriter()
            .on('a', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('link', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('img', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('script', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('iframe', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('source', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('track', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('form', new LinkRewriter(targetUrl.toString(), proxyBase))
            .on('meta', new LinkRewriter(targetUrl.toString(), proxyBase));

          const transformedHtml = await rewriter.transform(new Response(html, { headers: responseHeaders })).text();
          responseHeaders.set('content-length', transformedHtml.length.toString());

          // ذخیره در کش
          if (useCache && request.method === 'GET') {
            const cache = caches.default;
            ctx.waitUntil(cache.put(request, new Response(transformedHtml, { headers: responseHeaders })));
            responseHeaders.set('X-Proxy-Cache', 'MISS (CACHED)');
          }

          return new Response(transformedHtml, { status: response.status, headers: responseHeaders });
        }

        // --- حالت raw (بدون تغییر) ---
        if (useCache && request.method === 'GET' && response.ok) {
          const cache = caches.default;
          ctx.waitUntil(cache.put(request, response.clone()));
          responseHeaders.set('X-Proxy-Cache', 'MISS (CACHED)');
        }
        return new Response(response.body, { status: response.status, headers: responseHeaders });

      } catch (error) {
        lastError = error;
        breaker.recordFailure();
        if (attempt < CONFIG.RETRY.maxAttempts) {
          await sleep(delay);
          delay *= 2;
        }
      }
    }

    // --- خطای نهایی ---
    return new Response(JSON.stringify({
      error: 'Gateway Error',
      details: lastError?.name === 'AbortError' ? 'Request Timeout' : (lastError?.message || 'Unknown Error'),
      requestId
    }), {
      status: lastError?.name === 'AbortError' ? 504 : 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
