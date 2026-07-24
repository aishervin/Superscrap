// ================================================================
//  ☬Exclusive SHΞN™ made Enterprise Cloudflare Worker
//  Features: SSRF Protection, Rate Limiting, Smart Caching, 
//  Link Tracing, Custom Headers, Circuit Breaker
//  Zero-Dependency
// ================================================================

const CONFIG = {
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  ],
  CIRCUIT_BREAKER: { failureThreshold: 5, timeout: 30000 },
  RETRY: { maxAttempts: 3, baseDelay: 1000 },
  RATE_LIMIT: { maxRequestsPerMinute: 60 }, // محدودیت درخواست در دقیقه برای هر IP
  MAX_TIMEOUT: 30000 // حداکثر تایم‌اوت مجاز (میلی‌ثانیه)
};

// --- Utility: SSRF Protection ---
function isPrivateHost(hostname) {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i.test(hostname);
}

// --- Utility: Generate Request ID ---
function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// --- Class: Circuit Breaker ---
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

// --- Utility: CORS ---
function handleCors(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Expose-Headers', 'X-Proxy-Request-Id, X-Proxy-Execution-Time, X-Proxy-Final-Url');
  return headers;
}

// --- Utility: Simple Rate Limiting (using Cache API for persistence) ---
async function checkRateLimit(clientIp) {
  const cache = caches.default;
  const cacheKey = new Request(`https://rate-limit.internal/${clientIp}`);
  const cached = await cache.match(cacheKey);
  
  let count = cached ? parseInt(await cached.text()) : 0;
  if (count >= CONFIG.RATE_LIMIT.maxRequestsPerMinute) {
    return false; // Rate limit exceeded
  }
  
  count++;
  await cache.put(cacheKey, new Response(count.toString(), { 
    headers: { 'Cache-Control': `max-age=60` } 
  }));
  return true;
}

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const requestId = generateId();
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: handleCors(new Headers()) });
    }

    const url = new URL(request.url);
    const targetUrlStr = url.searchParams.get('url');
    const mode = url.searchParams.get('mode') || 'raw'; // raw, trace, headers
    const useCache = url.searchParams.get('cache') === 'true';
    const customTimeout = parseInt(url.searchParams.get('timeout')) || CONFIG.MAX_TIMEOUT;

    if (!targetUrlStr) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400, headers: handleCors(new Headers({ 'Content-Type': 'application/json', 'X-Proxy-Request-Id': requestId }))
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
      if (isPrivateHost(targetUrl.hostname)) {
        throw new Error('SSRF Blocked: Private IP/Hostname detected');
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid or Blocked target URL', details: e.message }), {
        status: 400, headers: handleCors(new Headers({ 'Content-Type': 'application/json', 'X-Proxy-Request-Id': requestId }))
      });
    }

    // 2. Rate Limiting Check
    const isAllowed = await checkRateLimit(clientIp);
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Max 60 req/min.' }), {
        status: 429, headers: handleCors(new Headers({ 'Content-Type': 'application/json', 'X-Proxy-Request-Id': requestId }))
      });
    }

    // 3. WebSocket & SSE Handling (Preserved from original)
    const upgradeHeader = request.headers.get('upgrade');
    if (upgradeHeader === 'websocket' || targetUrl.protocol === 'ws:' || targetUrl.protocol === 'wss:') {
      return handleWebSocket(request, targetUrl.toString(), requestId);
    }
    if ((request.headers.get('content-type') || '').includes('text/event-stream') || request.headers.get('accept')?.includes('text/event-stream')) {
      return handleSSE(request, targetUrl.toString(), requestId);
    }

    // 4. Circuit Breaker Check
    const breaker = getCircuitBreaker(targetUrl.host);
    if (breaker.isOpen()) {
      return new Response(JSON.stringify({ error: 'Service temporarily unavailable (Circuit Breaker Active)' }), {
        status: 503, headers: handleCors(new Headers({ 'Content-Type': 'application/json', 'X-Proxy-Request-Id': requestId }))
      });
    }

    // 5. Smart Caching Check (Only for GET/HEAD in raw mode)
    if (useCache && ['GET', 'HEAD'].includes(request.method) && mode === 'raw') {
      const cache = caches.default;
      const cacheResponse = await cache.match(request);
      if (cacheResponse) {
        cacheResponse.headers.set('X-Proxy-Cache-Status', 'HIT');
        cacheResponse.headers.set('X-Proxy-Request-Id', requestId);
        cacheResponse.headers.set('X-Proxy-Execution-Time', `${Date.now() - startTime}ms`);
        return new Response(cacheResponse.body, { status: cacheResponse.status, headers: handleCors(cacheResponse.headers) });
      }
    }

    // 6. Request Preparation
    let lastError = null;
    let delay = CONFIG.RETRY.baseDelay;

    for (let attempt = 1; attempt <= CONFIG.RETRY.maxAttempts; attempt++) {
      try {
        const headers = new Headers(request.headers);
        headers.set('User-Agent', CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)]);
        
        // Inject Custom Headers if provided by client (e.g., X-Proxy-Custom-Headers: {"Authorization": "Bearer 123"})
        const customHeadersStr = request.headers.get('x-proxy-custom-headers');
        if (customHeadersStr) {
          try {
            const customHeaders = JSON.parse(customHeadersStr);
            Object.keys(customHeaders).forEach(key => headers.set(key, customHeaders[key]));
          } catch (e) { /* Ignore invalid JSON */ }
        }

        // Sanitize unwanted headers
        ['host', 'connection', 'cf-connecting-ip', 'cf-worker', 'cf-ray', 'x-forwarded-for', 'x-real-ip', 'x-proxy-custom-headers']
          .forEach(h => headers.delete(h));

        const hasBody = !['GET', 'HEAD'].includes(request.method);
        let bodyData = undefined;
        if (hasBody) {
          bodyData = request.headers.get('content-type')?.includes('multipart/form-data') 
            ? await request.formData() 
            : await request.arrayBuffer();
        }

        // Dynamic Redirect Behavior based on mode
        const redirectBehavior = mode === 'trace' ? 'follow' : 'manual';

        // AbortController for dynamic timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), customTimeout);

        const response = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: headers,
          body: bodyData,
          redirect: redirectBehavior,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        breaker.recordSuccess();

        const responseHeaders = new Headers(response.headers);
        handleCors(responseHeaders);
        responseHeaders.set('X-Proxy-Request-Id', requestId);
        responseHeaders.set('X-Proxy-Execution-Time', `${Date.now() - startTime}ms`);
        responseHeaders.set('X-Proxy-Final-Url', response.url);

        // 7. Mode-Specific Responses
        if (mode === 'trace') {
          const traceData = {
            success: response.ok,
            originalUrl: targetUrlStr,
            finalUrl: response.url,
            statusCode: response.status,
            contentType: response.headers.get('content-type'),
            executionTimeMs: Date.now() - startTime,
            requestId: requestId
          };
          return new Response(JSON.stringify(traceData, null, 2), {
            status: 200,
            headers: handleCors(new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'X-Proxy-Request-Id': requestId }))
          });
        }

        if (mode === 'headers') {
          const headersObj = {};
          responseHeaders.forEach((value, key) => { headersObj[key] = value; });
          return new Response(JSON.stringify({ headers: headersObj, status: response.status }, null, 2), {
            status: 200,
            headers: handleCors(new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'X-Proxy-Request-Id': requestId }))
          });
        }

        // Default 'raw' mode (Standard Proxy)
        if (useCache && ['GET', 'HEAD'].includes(request.method) && response.ok) {
           const cache = caches.default;
           ctx.waitUntil(cache.put(request, response.clone()));
           responseHeaders.set('X-Proxy-Cache-Status', 'MISS (CACHED)');
        }

        return new Response(response.body, { status: response.status, headers: responseHeaders });

      } catch (error) {
        lastError = error;
        breaker.recordFailure();
        if (attempt < CONFIG.RETRY.maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        }
      }
    }

    // 8. Final Error Response
    return new Response(JSON.stringify({
      error: 'Gateway Fetch Failed',
      details: lastError?.name === 'AbortError' ? 'Request Timeout' : (lastError?.message || 'Unknown Network Error'),
      requestId: requestId
    }), {
      status: lastError?.name === 'AbortError' ? 504 : 502,
      headers: handleCors(new Headers({ 'Content-Type': 'application/json', 'X-Proxy-Request-Id': requestId }))
    });
  }
};

// --- WebSocket Handler (Unchanged logic, added requestId for logging if needed) ---
async function handleWebSocket(request, targetUrl, requestId) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  const targetWsUrl = targetUrl.replace(/^http/, 'ws');
  const backendWs = new WebSocket(targetWsUrl);

  backendWs.addEventListener('open', () => {
    server.addEventListener('message', (event) => {
      if (backendWs.readyState === WebSocket.OPEN) backendWs.send(event.data);
    });
  });
  backendWs.addEventListener('message', (event) => server.send(event.data));
  backendWs.addEventListener('close', (event) => server.close(event.code, event.reason));
  server.addEventListener('close', (event) => backendWs.close(event.code, event.reason));
  backendWs.addEventListener('error', () => server.close(1011, 'Backend connection error'));

  return new Response(null, { status: 101, webSocket: client });
}

// --- SSE Handler (Unchanged logic, added requestId) ---
async function handleSSE(request, targetUrl, requestId) {
  const headers = new Headers(request.headers);
  ['host', 'connection', 'cf-connecting-ip', 'cf-ray'].forEach(h => headers.delete(h));
  
  const response = await fetch(targetUrl, {
    method: request.method,
    headers: headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
  });

  const sseHeaders = new Headers(response.headers);
  handleCors(sseHeaders);
  sseHeaders.set('Cache-Control', 'no-cache');
  sseHeaders.set('Connection', 'keep-alive');
  sseHeaders.set('X-Proxy-Request-Id', requestId);

  return new Response(response.body, { status: response.status, headers: sseHeaders });
}
