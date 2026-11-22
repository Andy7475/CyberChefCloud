/**
 * The phone layout: decides when it is used, and runs the run screen
 * (input, recipe strip, output and a floating Bake button) and the ⋯ menu.
 *
 * Design and decisions: docs/MobileUI.md and docs/adr/0001-own-phone-layout-not-upstream-pr.md.
 * The phone layout reuses the desktop's elements and waiters; it never keeps its own copy of
 * the recipe. All phone styling is scoped under `body.mobile`.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import PhoneSheets from "./PhoneSheets.mjs";

/**
 * Screens that get the phone layout when the Layout option is "auto":
 * narrow screens, and touch screens that are short (a phone in landscape).
 */
export const PHONE_MEDIA_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 499px)";

/**
 * Controls the phone layout.
 */
class PhoneLayout {

    /**
     * PhoneLayout constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     */
    constructor(app, manager) {
        this.app = app;
        this.manager = manager;
        this.active = false;
        this.ready = false;
        this.mql = window.matchMedia(PHONE_MEDIA_QUERY);
        this.sheets = new PhoneSheets(app);
        this.renderQueued = false;
    }


    /**
     * Sets up listeners and applies the layout. Called once the desktop components exist.
     */
    setup() {
        this.mql.addEventListener("change", () => this.apply());

        // Keep the recipe strip in step with the recipe list, whatever changed it
        // (adding, removing, reordering, disabling, breakpoints, loading a recipe).
        new MutationObserver(() => this.queueRender())
            .observe(document.getElementById("rec-list"), {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["disabled", "break", "class"]
            });

        // Mirror the desktop Bake button's state (Bake!, Cancel, Loading...) on the floating one
        const bake = document.getElementById("bake");
        new MutationObserver(() => this.syncBakeButton())
            .observe(bake, {attributes: true, attributeFilter: ["class"], subtree: true, childList: true, characterData: true});

        document.getElementById("phone-bake").addEventListener("click", () => bake.click());
        document.getElementById("phone-menu-btn").addEventListener("click", () => this.openMenu());
        document.getElementById("phone-menu-items").addEventListener("click", this.menuClick.bind(this));
        document.getElementById("phone-auto-bake").addEventListener("change", this.menuAutoBakeChange.bind(this));
        document.getElementById("auto-bake").addEventListener("change", () => this.syncAutoBake());

        // Hide floating controls while the on-screen keyboard covers the page. Android (with
        // interactive-widget=resizes-content) shrinks the layout viewport, so fixed controls
        // stay above the keyboard. iOS Safari ignores that and only shrinks the visual viewport.
        const updateTyping = () => document.body.classList.toggle("phone-typing", this.isKeyboardCovering());
        document.addEventListener("focusin", updateTyping);
        document.addEventListener("focusout", () => setTimeout(updateTyping, 0));
        if (window.visualViewport) window.visualViewport.addEventListener("resize", updateTyping);

        this.ready = true;
        this.apply();
    }


    /**
     * Whether an element takes typed text, so focusing it brings up the on-screen keyboard.
     *
     * @param {Element} el
     * @returns {boolean}
     */
    static isTextField(el) {
        if (!el || !el.tagName) return false;
        if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
        if (el.tagName !== "INPUT") return false;
        return !["checkbox", "radio", "button", "submit", "file", "range", "color"].includes(el.type);
    }


    /**
     * Whether a text field has focus and the on-screen keyboard is covering part of the page
     * (the visual viewport is noticeably shorter than the layout viewport).
     *
     * @returns {boolean}
     */
    isKeyboardCovering() {
        if (!PhoneLayout.isTextField(document.activeElement) || !window.visualViewport) return false;
        return window.innerHeight - window.visualViewport.height > 100;
    }


    /**
     * Whether the phone layout should be used now, from the Layout option and the screen.
     *
     * @param {string} [layout] - The Layout option's value, if it has just changed
     * @returns {boolean}
     */
    isWanted(layout = this.app.options.layout) {
        switch (layout) {
            case "phone": return true;
            case "desktop": return false;
            default: return this.mql.matches;
        }
    }


    /**
     * Handler for changes to the Layout option. Uses the select's value, because this
     * can run before OptionsWaiter has stored the new value in app.options.
     *
     * @param {Event} e
     */
    layoutOptionChange(e) {
        if (this.ready) this.apply(e.target.value);
    }


    /**
     * Switches to or from the phone layout if needed.
     *
     * @param {string} [layout] - The Layout option's value, if it has just changed
     */
    apply(layout) {
        const wanted = this.isWanted(layout);
        if (wanted && !this.active) this.enter();
        else if (!wanted && this.active) this.leave();
    }


    /**
     * Switches to the phone layout.
     */
    enter() {
        this.active = true;

        // The output can be maximised on the desktop, which collapses the splitters.
        // Restore it first so leaving the phone layout returns a normal desktop layout.
        if (document.body.classList.contains("output-maximised")) {
            document.getElementById("maximise-output").click();
        }

        // The phone layout stacks the panes; the desktop splitters must not set their sizes
        if (this.app.columnSplitter) this.app.columnSplitter.destroy();
        if (this.app.ioSplitter) this.app.ioSplitter.destroy();
        this.app.columnSplitter = null;
        this.app.ioSplitter = null;

        document.body.classList.add("mobile");
        this.render();
        this.syncBakeButton();
        this.app.adjustComponentSizes();
    }


    /**
     * Switches back to the desktop layout.
     */
    leave() {
        this.active = false;
        this.sheets.closeAll();
        document.body.classList.remove("mobile");
        this.app.initialiseSplitter();
    }


    /**
     * Re-renders the recipe strip once per animation frame, however many changes arrive.
     */
    queueRender() {
        if (!this.active || this.renderQueued) return;
        this.renderQueued = true;
        window.requestAnimationFrame(() => {
            this.renderQueued = false;
            this.render();
        });
    }


    /**
     * Draws the recipe strip from the current recipe config.
     */
    render() {
        const list = document.getElementById("phone-recipe-ops");
        const config = this.app.getRecipeConfig();
        list.textContent = "";

        if (!config.length) {
            const empty = document.createElement("li");
            empty.className = "phone-recipe-empty";
            empty.textContent = "No operations in the recipe";
            list.appendChild(empty);
            return;
        }

        config.forEach((op, i) => {
            const li = document.createElement("li");
            li.className = "phone-recipe-op";
            li.dataset.index = i;
            li.textContent = op.op;

            const states = [];
            if (op.disabled) {
                li.classList.add("disabled");
                states.push("disabled");
            }
            if (op.breakpoint) {
                li.classList.add("breakpoint");
                states.push("breakpoint");
            }
            li.setAttribute("aria-label",
                `${i + 1}. ${op.op}${states.length ? ` (${states.join(", ")})` : ""}`);
            list.appendChild(li);
        });
    }


    /**
     * Copies the desktop Bake button's label and colour to the floating Bake button.
     */
    syncBakeButton() {
        const bake = document.getElementById("bake");
        const phoneBake = document.getElementById("phone-bake");
        const label = bake.querySelector("span").textContent.trim() || "Bake!";

        phoneBake.querySelector(".phone-bake-label").textContent = label;
        phoneBake.setAttribute("aria-label", label.replace(/!$/, ""));
        phoneBake.querySelector(".material-icons").textContent =
            label === "Cancel" ? "stop" : label.startsWith("Loading") ? "hourglass_empty" : "play_arrow";

        ["btn-success", "btn-danger", "btn-warning"].forEach(cls =>
            phoneBake.classList.toggle(cls, bake.classList.contains(cls)));
    }


    /**
     * Opens the ⋯ menu sheet.
     */
    openMenu() {
        this.syncAutoBake();
        this.sheets.open(document.getElementById("phone-menu-sheet"));
    }


    /**
     * Copies the desktop Auto Bake checkbox to the menu's toggle.
     */
    syncAutoBake() {
        document.getElementById("phone-auto-bake").checked = document.getElementById("auto-bake").checked;
    }


    /**
     * Handler for the menu's Auto Bake toggle: changes the desktop checkbox, which owns the setting.
     */
    menuAutoBakeChange() {
        const desktop = document.getElementById("auto-bake");
        const wanted = document.getElementById("phone-auto-bake").checked;
        if (desktop.checked !== wanted) desktop.click();
    }


    /**
     * Handler for clicks on the ⋯ menu's items. Each item closes the menu and then uses the
     * matching desktop control, so the behaviour is the same in both layouts.
     *
     * @param {MouseEvent} e
     */
    menuClick(e) {
        const item = e.target.closest("[data-phone-action]");
        if (!item) return;

        const targets = {
            options: "options",
            load: "load",
            clear: "clr-recipe",
            about: "support"
        };
        const target = document.getElementById(targets[item.dataset.phoneAction]);
        this.sheets.close();
        if (target) target.click();
    }

}

export default PhoneLayout;
