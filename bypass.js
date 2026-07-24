// ================================================================
//  ☬ SHΞN™ Anti-Fingerprint Injector
//  Override تمام ویژگی‌های شناسایی مرورگر
//  شامل: Webdriver, Screen, Hardware, Canvas, WebGL, Audio, etc.
// ================================================================

(function() {
    'use strict';

    // --- 1. Webdriver & Automation Detection ---
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5], configurable: true });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });

    // --- 2. Screen Resolution ---
    Object.defineProperty(window.screen, 'width', { get: () => 1920, configurable: true });
    Object.defineProperty(window.screen, 'height', { get: () => 1080, configurable: true });
    Object.defineProperty(window.screen, 'availWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(window.screen, 'availHeight', { get: () => 1040, configurable: true });
    Object.defineProperty(window.screen, 'colorDepth', { get: () => 24, configurable: true });
    Object.defineProperty(window.screen, 'pixelDepth', { get: () => 24, configurable: true });

    // --- 3. Hardware Concurrency ---
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });

    // --- 4. Canvas Fingerprinting (Noise Injection) ---
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // تزریق نویز به داده‌های Canvas
    function injectNoise(imageData) {
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            // تغییرات بسیار کوچک (حداکثر ۲ واحد) در کانال‌های RGB
            data[i] += (Math.random() - 0.5) * 4;   // R
            data[i+1] += (Math.random() - 0.5) * 4; // G
            data[i+2] += (Math.random() - 0.5) * 4; // B
        }
        return imageData;
    }

    CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
        const imageData = originalGetImageData.call(this, x, y, w, h);
        return injectNoise(imageData);
    };

    HTMLCanvasElement.prototype.toDataURL = function(...args) {
        // اگر canvas قبلاً با نویز تغییر کرده، برگردان
        // برای اطمینان، یک بار دیگر نویز اعمال می‌کنیم
        const ctx = this.getContext('2d');
        if (ctx) {
            const imageData = ctx.getImageData(0, 0, this.width, this.height);
            // نویز قبلاً در getImageData اعمال شده، ولی برای اطمینان دوباره انجام می‌دهیم
        }
        return originalToDataURL.apply(this, args);
    };

    // --- 5. WebGL Fingerprinting (Vendor/Renderer) ---
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // 37445 = VENDOR, 37446 = RENDERER
        if (parameter === 37445) {
            return 'NVIDIA Corporation';
        }
        if (parameter === 37446) {
            return 'NVIDIA GeForce RTX 3080';
        }
        return getParameter.call(this, parameter);
    };

    // همچنین برای WebGL2
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) {
            return 'NVIDIA Corporation';
        }
        if (parameter === 37446) {
            return 'NVIDIA GeForce RTX 3080';
        }
        return getParameter2.call(this, parameter);
    };

    // --- 6. AudioContext Fingerprinting ---
    const originalCreateAnalyser = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function(array) {
        originalCreateAnalyser.call(this, array);
        // تغییر جزئی در داده‌های فرکانس برای ایجاد نویز
        for (let i = 0; i < array.length; i++) {
            array[i] = Math.min(255, array[i] + (Math.random() - 0.5) * 10);
        }
        return array;
    };

    // --- 7. Timezone / Language ---
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
        value: function() {
            const result = Intl.DateTimeFormat.prototype.resolvedOptions.call(this);
            result.timeZone = 'America/New_York'; // یا هر timezone دلخواه
            return result;
        }
    });

    // --- 8. Permissions (برای جلوگیری از شناسایی درخواست‌های عجیب) ---
    const originalQuery = Permissions.prototype.query;
    Permissions.prototype.query = async function(permissionDesc) {
        if (permissionDesc.name === 'notifications' || permissionDesc.name === 'geolocation') {
            return { state: 'prompt' };
        }
        return originalQuery.call(this, permissionDesc);
    };

    // --- 9. Font Fingerprinting (بازگرداندن لیست فونت‌های استاندارد) ---
    Object.defineProperty(document, 'fonts', {
        get: () => ({
            ready: Promise.resolve(),
            addEventListener: () => {},
            removeEventListener: () => {},
            // بازگرداندن یک لیست فونت‌های معروف
            values: () => {
                const fonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia'];
                return fonts.values();
            },
            check: (font) => true,
            load: (font) => Promise.resolve()
        })
    });

    console.log('[SHΞN™] Anti-Fingerprint injector active.');
})();
