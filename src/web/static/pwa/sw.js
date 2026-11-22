/**
 * CyberChefCloud service worker: lets the installed app open and bake local operations offline.
 *
 * - index.html (page navigations): network first, falling back to the cached copy offline.
 * - Other files from this site: cache first, in a cache named for this build. A new build
 *   changes BUILD_ID, so the browser installs the new worker, which deletes old caches.
 * - Cross-origin requests (Google APIs, model downloads) and non-GET requests are never cached.
 * - Shared input (Web Share Target, Android): the POST to ./share-target is stored in the
 *   "ccc-shared-input" cache under a one-time id, then the browser is sent to ./?share=<id>.
 *   The page reads it, loads it into the input and deletes it (src/web/mobile/PhoneShare.mjs).
 *
 * The build sets BUILD_ID (webpack.config.js). Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const BUILD_ID = "__BUILD_ID__";
const CACHE = `ccc-${BUILD_ID}`;
const INDEX = new URL("./", self.registration.scope).href;
const SHARE_ACTION = new URL("./share-target", self.registration.scope).href;
const SHARE_CACHE = "ccc-shared-input";

self.addEventListener("install", event => {
    // Cache the page now, so the app opens offline even if it was only visited once
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.add(new Request(INDEX, {cache: "reload"})))
            .catch(() => {})
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith("ccc-") && k !== CACHE && k !== SHARE_CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method === "POST" && request.url.split("?")[0] === SHARE_ACTION) {
        event.respondWith(receiveShare(request));
        return;
    }
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (request.headers.has("range")) return;

    if (request.mode === "navigate") {
        event.respondWith(networkFirst(request));
    } else {
        event.respondWith(cacheFirst(request));
    }
});

/**
 * Network first for the page: always fresh online, the cached page offline.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(INDEX, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(INDEX);
        if (cached) return cached;
        throw err;
    }
}

/**
 * Cache first for the app's files.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") cache.put(request, response.clone());
    return response;
}


/**
 * Stores shared data from the phone's Share menu and sends the browser to the app.
 * Each shared file is stored as its own response; a JSON entry lists them with the text.
 *
 * @param {Request} request - The share target's multipart POST
 * @returns {Promise<Response>}
 */
async function receiveShare(request) {
    const id = self.crypto.randomUUID();
    const target = new URL(`./?share=${id}`, self.registration.scope).href;
    try {
        const form = await request.formData();
        const cache = await caches.open(SHARE_CACHE);
        const files = form.getAll("files").filter(f => f && typeof f !== "string" && f.size > 0);
        const meta = {
            title: form.get("title") || "",
            text: form.get("text") || "",
            url: form.get("url") || "",
            files: files.map(f => ({name: f.name, type: f.type}))
        };
        await Promise.all(files.map((f, i) =>
            cache.put(new URL(`./shared-input/${id}/${i}`, self.registration.scope).href, new Response(f))));
        await cache.put(new URL(`./shared-input/${id}/meta`, self.registration.scope).href,
            new Response(JSON.stringify(meta), {headers: {"Content-Type": "application/json"}}));
    } catch (err) {
        return Response.redirect(new URL("./?share=failed", self.registration.scope).href, 303);
    }
    return Response.redirect(target, 303);
}
