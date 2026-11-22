/**
 * Registers the service worker that makes CyberChefCloud installable and usable offline
 * (src/web/static/pwa/sw.js). Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

/**
 * Registers the service worker in production builds on secure pages. The dev server does not
 * use it unless `localStorage.enableServiceWorker` is "true" (for testing).
 */
export function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let enabledForTesting = false;
    try {
        enabledForTesting = localStorage.getItem("enableServiceWorker") === "true";
    } catch (err) {
        // Storage blocked: production builds still register
    }
    if (process.env.NODE_ENV !== "production" && !enabledForTesting) return;

    // When a new build's worker takes over a page loaded by an older one, reload once so the
    // page and its files come from the same build
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || reloading) return;
        reloading = true;
        window.location.reload();
    });

    navigator.serviceWorker.register("sw.js").catch(err => {
        // The app works without it, just not offline
        // eslint-disable-next-line no-console
        console.warn("Service worker registration failed:", err);
    });
}
