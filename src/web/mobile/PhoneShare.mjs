/**
 * Shared input for the phone layout: data shared to the installed app from another app's Share
 * menu (Web Share Target, Android only). The service worker stores the shared data and opens
 * the app at ./?share=<id> (src/web/static/pwa/sw.js). This module loads it into the input,
 * deletes the stored copy, and offers a recipe to run: Current recipe first, then the saved
 * recipes.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Utils from "../../core/Utils.mjs";
import PhoneRecipes from "./PhoneRecipes.mjs";

export const SHARE_CACHE = "ccc-shared-input";

/**
 * Receives shared input and offers a recipe to run on it.
 */
class PhoneShare {

    /**
     * PhoneShare constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {PhoneLayout} layout - The phone layout: its sheets, input bar and saved recipes.
     */
    constructor(app, layout) {
        this.app = app;
        this.layout = layout;
    }


    /**
     * Sets up the picker, and loads shared input if the page was opened with some.
     */
    setup() {
        this.sheet = document.getElementById("phone-share-sheet");
        document.getElementById("phone-share-list").addEventListener("click", e => {
            const pick = e.target.closest(".phone-pick");
            if (pick) this.run(pick.dataset.id);
        });

        const id = new URLSearchParams(window.location.search).get("share");
        if (id !== null) {
            // Remove ?share= so a reload does not try again
            const url = new URL(window.location.href);
            url.searchParams.delete("share");
            window.history.replaceState(window.history.state, "", url.href);
        }
        this.whenLoaded(() => this.receive(id));
    }


    /**
     * Runs a callback once the app has finished loading.
     *
     * @param {Function} callback
     */
    whenLoaded(callback) {
        const check = () => {
            if (this.app.appLoaded && this.layout.manager.input.inputWorker) {
                callback();
            } else {
                setTimeout(check, 100);
            }
        };
        check();
    }


    /**
     * Loads the shared data with this id (if any), and deletes every stored share, including
     * ones abandoned on earlier visits.
     *
     * @param {string|null} id
     */
    async receive(id) {
        if (!("caches" in window)) return;
        let shared = null;
        try {
            if (id === "failed") {
                this.app.alert("The shared data could not be received.", 5000);
            } else if (id) {
                shared = await PhoneShare.read(id);
            }
        } catch (err) {
            this.app.alert(`The shared data could not be read: ${err.message}`, 5000);
        }
        try {
            await caches.delete(SHARE_CACHE);
        } catch (err) {
            // Nothing stored
        }
        if (shared) this.load(shared);
    }


    /**
     * Reads one share from the service worker's cache.
     *
     * @param {string} id
     * @returns {Promise<{text: string, files: File[]}|null>}
     */
    static async read(id) {
        if (!/^[\w-]+$/.test(id)) return null;
        const cache = await caches.open(SHARE_CACHE);
        const base = new URL(`./shared-input/${id}/`, window.location.href).href;
        const metaResponse = await cache.match(base + "meta");
        if (!metaResponse) return null;
        const meta = await metaResponse.json();

        const files = [];
        for (let i = 0; i < meta.files.length; i++) {
            const response = await cache.match(base + i);
            if (!response) continue;
            const blob = await response.blob();
            files.push(new File([blob], meta.files[i].name || `shared-${i + 1}`, {type: meta.files[i].type || blob.type}));
        }
        return {text: PhoneShare.combineText(meta), files};
    }


    /**
     * Combines shared title, text and URL into one text input, without repeating any part
     * (apps often put the URL in the text too).
     *
     * @param {{title: string, text: string, url: string}} meta
     * @returns {string}
     */
    static combineText({title, text, url}) {
        const parts = [];
        [title, text, url].map(p => (p || "").trim()).forEach(part => {
            if (part && !parts.some(p => p.includes(part))) parts.push(part);
        });
        return parts.join("\n");
    }


    /**
     * Puts shared data into the input (text first, then one input per file) and opens the picker.
     *
     * @param {{text: string, files: File[]}} shared
     */
    load(shared) {
        if (!shared.text && !shared.files.length) return;
        if (shared.text) this.app.setInput(shared.text);
        if (shared.files.length) this.layout.input.loadFiles(shared.files);

        const parts = [];
        if (shared.text) parts.push("text");
        if (shared.files.length) parts.push(shared.files.length === 1 ? shared.files[0].name : `${shared.files.length} files`);
        document.getElementById("phone-share-summary").textContent = `Received ${parts.join(" and ")}.`;

        if (this.layout.active) this.openPicker();
    }


    /**
     * Opens the recipe picker: Current recipe first, then the saved recipes.
     */
    openPicker() {
        const list = document.getElementById("phone-share-list");
        list.textContent = "";
        const current = this.app.getRecipeConfig().map(op => op.op).join(" → ");
        list.appendChild(PhoneShare.row("current", "Current recipe", current || "No operations", true));
        this.layout.recipes.read().slice().reverse().forEach(r => {
            list.appendChild(PhoneShare.row(String(r.id), Utils.unescapeHtml(r.name), PhoneRecipes.describe(r.recipe)));
        });
        this.layout.sheets.open(this.sheet);
    }


    /**
     * Builds one row of the picker.
     *
     * @param {string} id - "current" or a saved recipe's id
     * @param {string} name
     * @param {string} description
     * @param {boolean} [current]
     * @returns {HTMLLIElement}
     */
    static row(id, name, description, current = false) {
        const li = document.createElement("li");
        li.className = "phone-pick-row";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "phone-pick" + (current ? " phone-pick-current" : "");
        button.dataset.id = id;
        button.setAttribute("aria-label", `Run ${name}`);
        const title = document.createElement("span");
        title.className = "phone-pick-name";
        title.textContent = name;
        const desc = document.createElement("span");
        desc.className = "phone-pick-desc";
        desc.textContent = description;
        button.append(title, desc);
        li.appendChild(button);
        return li;
    }


    /**
     * Loads the chosen recipe (unless it is the current one) and bakes every input.
     *
     * @param {string} id
     */
    run(id) {
        if (id !== "current") {
            const saved = this.layout.recipes.read().find(r => String(r.id) === id);
            if (!saved) return;
            try {
                this.app.setRecipeConfig(Utils.parseRecipeConfig(saved.recipe));
            } catch (err) {
                this.app.alert("This saved recipe could not be read.", 3000);
                return;
            }
        }
        this.layout.sheets.close();
        // The Bake button bakes every input
        document.getElementById("bake").click();
    }

}

export default PhoneShare;
