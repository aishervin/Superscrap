/**
 * ============================================================================
 *  ☬ SHΞN™ MONSTER SCRAPER | DYNAMIC CORS PROXY GATEWAY (IFRAME UNLOCKED)
 * ============================================================================
 *  Architect & Lead Developer: Shervin (☬SHΞN™)
 *  Network & Security Domain: T.me/aishervin | Shervinofpersia.github.io
 * 
 *  Description: 
 *  Serverless Dynamic CORS Proxy + HTML Rewriter. 
 *  Strips X-Frame-Options & CSP headers to allow embedding ANY site in iframes.
 * 
 *  Exclusive ☬SHΞN™ made.
 * ============================================================================
 */

export default {
    async fetch(request) {
        const url = new URL(request.url);
        
        let targetUrlStr = url.pathname.substring(1) + url.search;

        if (!targetUrlStr) {
            return new Response("☬ SHΞN™ Proxy Hub is Active.\nUsage: /https://example.com", { 
                status: 200, 
                headers: { 'Content-Type': 'text/plain' } 
            });
        }

        if (!targetUrlStr.startsWith('http')) {
            targetUrlStr = 'https://' + targetUrlStr;
        }

        try {
            const targetUrl = new URL(targetUrlStr);
            
            const modifiedRequest = new Request(targetUrl, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                redirect: 'follow'
            });

            modifiedRequest.headers.delete('Host');
            modifiedRequest.headers.delete('Origin');
            modifiedRequest.headers.delete('Referer');

            const response = await fetch(modifiedRequest);
            const contentType = response.headers.get("content-type") || "";

            let proxyResponse = new Response(response.body, response);
            
            proxyResponse.headers.set('Access-Control-Allow-Origin', '*');
            proxyResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

            // 🔥 حذف هدرهای امنیتی ضد Iframe (برای باز شدن در داشبورد)
            proxyResponse.headers.delete('X-Frame-Options');
            proxyResponse.headers.delete('Content-Security-Policy');
            proxyResponse.headers.delete('Content-Security-Policy-Report-Only');
            proxyResponse.headers.delete('Clear-Site-Data');

            if (contentType.includes("text/html")) {
                return new HTMLRewriter()
                    .on("head", new ShenAntiFingerprintInjector())
                    .transform(proxyResponse);
            }

            return proxyResponse;
            
        } catch (error) {
            return new Response(`[☬SHΞN™ Proxy Error]: ${error.message}`, { status: 500 });
        }
    }
};

class ShenAntiFingerprintInjector {
    element(element) {
        const payload = `
        <script>
        (function() {
            'use strict';
            Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5], configurable: true });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
            
            Object.defineProperty(window.screen, 'width', { get: () => 1920, configurable: true });
            Object.defineProperty(window.screen, 'height', { get: () => 1080, configurable: true });
            Object.defineProperty(window.screen, 'availWidth', { get: () => 1920, configurable: true });
            Object.defineProperty(window.screen, 'availHeight', { get: () => 1040, configurable: true });
            Object.defineProperty(window.screen, 'colorDepth', { get: () => 24, configurable: true });
            Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24, configurable: true });
            
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
            
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
            
            function injectNoise(imageData) {
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    data[i] += (Math.random() - 0.5) * 4;
                    data[i+1] += (Math.random() - 0.5) * 4;
                    data[i+2] += (Math.random() - 0.5) * 4;
                }
                return imageData;
            }
            
            CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
                const imageData = originalGetImageData.call(this, x, y, w, h);
                return injectNoise(imageData);
            };
            
            HTMLCanvasElement.prototype.toDataURL = function(...args) {
                const ctx = this.getContext('2d');
                if (ctx) ctx.getImageData(0, 0, this.width, this.height); 
                return originalToDataURL.apply(this, args);
            };
            
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'NVIDIA Corporation'; 
                if (parameter === 37446) return 'NVIDIA GeForce RTX 3080'; 
                return getParameter.call(this, parameter);
            };
            
            const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return 'NVIDIA Corporation';
                if (parameter === 37446) return 'NVIDIA GeForce RTX 3080';
                return getParameter2.call(this, parameter);
            };
            
            const originalCreateAnalyser = AnalyserNode.prototype.getByteFrequencyData;
            AnalyserNode.prototype.getByteFrequencyData = function(array) {
                originalCreateAnalyser.call(this, array);
                for (let i = 0; i < array.length; i++) {
                    array[i] = Math.min(255, array[i] + (Math.random() - 0.5) * 10);
                }
                return array;
            };
            
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                value: function() {
                    const result = Intl.DateTimeFormat.prototype.resolvedOptions.call(this);
                    result.timeZone = 'America/New_York';
                    return result;
                }
            });
            
            const originalQuery = Permissions.prototype.query;
            Permissions.prototype.query = async function(permissionDesc) {
                if (permissionDesc.name === 'notifications' || permissionDesc.name === 'geolocation') {
                    return { state: 'prompt' }; 
                }
                return originalQuery.call(this, permissionDesc);
            };
            
            Object.defineProperty(document, 'fonts', {
                get: () => ({
                    ready: Promise.resolve(),
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    values: () => {
                        const standardFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia'];
                        return standardFonts.values();
                    },
                    check: () => true,
                    load: () => Promise.resolve()
                })
            });
            
            console.log('%c[☬SHΞN™ Core] Anti-Fingerprint Protocol Initialized.', 'color: #00ff00; font-weight: bold; background: #000; padding: 5px;');
        })();
        </script>
        `;
        
        element.prepend(payload, { html: true });
    }
}
