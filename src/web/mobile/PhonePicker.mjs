/**
 * The phone layout's operation picker: a full-screen sheet for finding an operation and
 * adding it to the end of the recipe with a single tap, followed by an "Added X — Undo" message.
 *
 * Search uses the desktop's OperationsWaiter.filterOperations, and adding uses the desktop's
 * RecipeWaiter.addOperation, so matching, highlighting, recipe-change events and manualBake
 * behave as on the desktop. Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import DOMPurify from "dompurify";

/** localStorage key for the operations most recently added from the picker */
const RECENT_KEY = "phoneRecentOperations";
const RECENT_MAX = 8;
/** How long the "Added X — Undo" message stays up */
const TOAST_MS = 6000;

/**
 * Controls the operation picker and its Undo message.
 */
class PhonePicker {

    /**
     * PhonePicker constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     * @param {PhoneSheets} sheets - The phone layout's sheets.
     */
    constructor(app, manager, sheets) {
        this.app = app;
        this.manager = manager;
        this.sheets = sheets;
        this.lastAdded = null;
        this.toastTimer = null;
    }


    /**
     * Finds the picker's elements and sets up its listeners.
     */
    setup() {
        this.sheet = document.getElementById("phone-picker-sheet");
        this.search = document.getElementById("phone-picker-search");
        this.results = document.getElementById("phone-picker-results");
        this.toast = document.getElementById("phone-toast");

        document.getElementById("phone-add-op").addEventListener("click", () => this.open());
        document.getElementById("phone-picker-back").addEventListener("click", () => this.sheets.close());

        this.search.addEventListener("input", () => this.render());
        this.search.addEventListener("keydown", e => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const first = this.results.querySelector(".phone-pick");
            if (first) this.add(first.dataset.op);
        });

        // A tap on a result. Plain click events are used: the picker's lists are not SortableJS
        // lists, so taps produce clicks, and the browser does not send a click after a scroll.
        this.results.addEventListener("click", e => {
            const fav = e.target.closest(".phone-pick-fav");
            if (fav) {
                this.toggleFavourite(fav.dataset.op);
                return;
            }
            const pick = e.target.closest(".phone-pick");
            if (pick) this.add(pick.dataset.op);
        });

        // Categories are filled in when opened ("toggle" does not bubble, so listen in the capture phase)
        this.results.addEventListener("toggle", e => {
            const details = e.target;
            if (details.open && details.dataset.category && !details.dataset.filled) {
                details.dataset.filled = "true";
                const cat = this.app.categories.find(c => c.name === details.dataset.category);
                if (cat) details.appendChild(this.opList(cat.ops));
            }
        }, true);

        this.toast.querySelector(".phone-toast-action").addEventListener("click", () => this.undo());
    }


    /**
     * Opens the picker with an empty search field that has focus, so the keyboard comes up.
     */
    open() {
        this.hideToast();
        this.search.value = "";
        this.render();
        this.sheets.open(this.sheet);
        this.search.focus();
        this.results.scrollTop = 0;
    }


    /**
     * Shows search results, or the starting lists when the search field is empty.
     */
    render() {
        const str = this.search.value;
        this.results.textContent = "";

        if (str) {
            const ops = this.manager.ops.filterOperations(str, true);
            if (!ops.length) {
                const none = document.createElement("p");
                none.className = "phone-picker-empty";
                none.textContent = "No matching operations";
                this.results.appendChild(none);
                return;
            }
            const list = document.createElement("ul");
            list.className = "phone-pick-list";
            list.setAttribute("aria-label", "Search results");
            ops.forEach(op => {
                const name = op.name.replace(/<\/?b>/g, "");
                list.appendChild(this.opItem(name, op.name, op.description));
            });
            this.results.appendChild(list);
            return;
        }

        const favCat = this.app.categories.find(c => c.name === "Favourites");
        if (favCat && favCat.ops.length) this.section("Favourites", favCat.ops);

        const recent = this.recent();
        if (recent.length) this.section("Recently used", recent);

        this.heading("Categories");
        this.app.categories
            .filter(c => c.name !== "Favourites")
            .forEach(cat => {
                const details = document.createElement("details");
                details.className = "phone-pick-category";
                details.dataset.category = cat.name;
                const summary = document.createElement("summary");
                summary.textContent = cat.name;
                details.appendChild(summary);
                this.results.appendChild(details);
            });
    }


    /**
     * Adds a heading to the results.
     *
     * @param {string} title
     */
    heading(title) {
        const h = document.createElement("h3");
        h.className = "phone-pick-heading";
        h.textContent = title;
        this.results.appendChild(h);
    }


    /**
     * Adds a titled list of operations to the results.
     *
     * @param {string} title
     * @param {string[]} names - Operation names
     */
    section(title, names) {
        this.heading(title);
        const list = this.opList(names);
        list.setAttribute("aria-label", title);
        this.results.appendChild(list);
    }


    /**
     * Builds a list of operations.
     *
     * @param {string[]} names - Operation names
     * @returns {HTMLUListElement}
     */
    opList(names) {
        const list = document.createElement("ul");
        list.className = "phone-pick-list";
        names
            .filter(name => name in this.app.operations)
            .forEach(name => list.appendChild(this.opItem(name, name, this.app.operations[name].description)));
        return list;
    }


    /**
     * Builds one operation's row: a button that adds it, and a favourite toggle.
     *
     * @param {string} name - The operation's name
     * @param {string} nameHtml - The name, with search matches in <b> tags
     * @param {string} descHtml - The description, possibly with search matches highlighted
     * @returns {HTMLLIElement}
     */
    opItem(name, nameHtml, descHtml) {
        const li = document.createElement("li");
        li.className = "phone-pick-row";

        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "phone-pick";
        pick.dataset.op = name;
        pick.setAttribute("aria-label", `Add ${name}`);

        const title = document.createElement("span");
        title.className = "phone-pick-name";
        title.innerHTML = DOMPurify.sanitize(nameHtml, {ALLOWED_TAGS: ["b"]});
        pick.appendChild(title);

        if (descHtml) {
            const desc = document.createElement("span");
            desc.className = "phone-pick-desc";
            desc.innerHTML = DOMPurify.sanitize(descHtml);
            // Links in descriptions would take the tap meant for the row
            desc.querySelectorAll("a").forEach(a => a.replaceWith(...a.childNodes));
            pick.appendChild(desc);
        }

        const fav = document.createElement("button");
        fav.type = "button";
        fav.className = "phone-pick-fav phone-icon-btn";
        fav.dataset.op = name;
        fav.innerHTML = "<i class='material-icons' aria-hidden='true'></i>";
        this.setFavButton(fav, this.isFavourite(name));

        li.appendChild(pick);
        li.appendChild(fav);
        return li;
    }


    /**
     * Whether an operation is one of the user's favourites.
     *
     * @param {string} name
     * @returns {boolean}
     */
    isFavourite(name) {
        const favCat = this.app.categories.find(c => c.name === "Favourites");
        return Boolean(favCat && favCat.ops.includes(name));
    }


    /**
     * Shows a favourite toggle as on or off.
     *
     * @param {HTMLButtonElement} button
     * @param {boolean} on
     */
    setFavButton(button, on) {
        const name = button.dataset.op;
        button.setAttribute("aria-pressed", String(on));
        button.setAttribute("aria-label", `Favourite ${name}`);
        button.querySelector(".material-icons").textContent = on ? "star" : "star_border";
    }


    /**
     * Adds or removes an operation from the favourites the desktop uses, and updates its toggles
     * in place so the list does not jump.
     *
     * @param {string} name
     */
    toggleFavourite(name) {
        if (this.isFavourite(name)) {
            this.app.removeFavourite(name);
        } else {
            this.app.addFavourite(name);
        }
        const on = this.isFavourite(name);
        this.results.querySelectorAll(".phone-pick-fav").forEach(button => {
            if (button.dataset.op === name) this.setFavButton(button, on);
        });
    }


    /**
     * Adds an operation to the end of the recipe, closes the picker and offers Undo.
     *
     * @param {string} name
     */
    add(name) {
        if (!(name in this.app.operations)) return;
        const item = this.manager.recipe.addOperation(name);
        this.remember(name);
        this.sheets.close();
        this.showToast(`Added ${name}`, item);
    }


    /**
     * The operations most recently added from the picker, newest first.
     *
     * @returns {string[]}
     */
    recent() {
        try {
            const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
            return Array.isArray(list) ? list.filter(name => name in this.app.operations) : [];
        } catch (err) {
            return [];
        }
    }


    /**
     * Records an operation as recently used.
     *
     * @param {string} name
     */
    remember(name) {
        const list = [name, ...this.recent().filter(n => n !== name)].slice(0, RECENT_MAX);
        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(list));
        } catch (err) {
            // Storage is not available; the picker just has no recent list
        }
    }


    /**
     * Shows the "Added X — Undo" message.
     *
     * @param {string} text
     * @param {HTMLElement} item - The recipe operation that Undo removes
     */
    showToast(text, item) {
        this.lastAdded = item;
        this.toast.querySelector(".phone-toast-text").textContent = text;
        this.toast.hidden = false;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.hideToast(), TOAST_MS);
    }


    /**
     * Hides the Undo message.
     */
    hideToast() {
        clearTimeout(this.toastTimer);
        this.toast.hidden = true;
        this.lastAdded = null;
    }


    /**
     * Removes the operation that was just added, the same way the desktop removes one.
     */
    undo() {
        const item = this.lastAdded;
        const recList = document.getElementById("rec-list");
        this.hideToast();
        if (!item || !recList.contains(item)) return;
        item.remove();
        recList.dispatchEvent(this.manager.operationremove);
    }

}

export default PhonePicker;
