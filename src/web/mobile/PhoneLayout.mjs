/**
 * The phone layout: decides when it is used, and runs the run screen
 * (input, recipe strip, output and a floating Bake button), the argument sheet, the operation
 * picker (PhonePicker.mjs) and the ⋯ menu.
 *
 * Design and decisions: docs/MobileUI.md and docs/adr/0001-own-phone-layout-not-upstream-pr.md.
 * The phone layout reuses the desktop's elements and waiters; it never keeps its own copy of
 * the recipe. All phone styling is scoped under `body.mobile`.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Sortable from "sortablejs";
import PhoneSheets from "./PhoneSheets.mjs";
import PhonePicker from "./PhonePicker.mjs";
import PhoneInput from "./PhoneInput.mjs";

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
        this.picker = new PhonePicker(app, manager, this.sheets);
        this.input = new PhoneInput(app, manager);
        this.renderQueued = false;
        // Where #rec-list lives in the desktop layout, while it is in the argument sheet
        this.recListHome = null;
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

        this.picker.setup();
        this.input.setup();

        document.getElementById("phone-share-output").addEventListener("click",
            this.manager.output.shareClick.bind(this.manager.output));

        // Argument sheet: tap an operation in the recipe strip
        const strip = document.getElementById("phone-recipe-ops");
        strip.addEventListener("click", this.stripClick.bind(this));
        strip.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                this.stripClick(e);
            }
        });
        const argSheet = document.getElementById("phone-arg-sheet");
        document.getElementById("phone-arg-done").addEventListener("click", () => this.sheets.close());
        // On the desktop, double-clicking an operation removes it. In the sheet a double tap
        // is an accident, so stop it before it reaches the recipe list's handlers.
        argSheet.addEventListener("dblclick", e => e.stopPropagation(), true);
        document.getElementById("phone-auto-bake").addEventListener("change", this.menuAutoBakeChange.bind(this));
        document.getElementById("auto-bake").addEventListener("change", () => this.syncAutoBake());

        // Hide floating controls while the on-screen keyboard covers the page. Android (with
        // interactive-widget=resizes-content) shrinks the layout viewport, so fixed controls
        // stay above the keyboard. iOS Safari ignores that and only shrinks the visual viewport.
        const updateTyping = () => {
            document.body.classList.toggle("phone-typing", this.isKeyboardCovering());
            document.body.classList.toggle("phone-text-focus", PhoneLayout.isTextField(document.activeElement));
            this.keepSheetsAboveKeyboard();
        };
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
     * Keeps open sheets inside the visual viewport and the focused field in view. Needed on iOS,
     * where the keyboard covers fixed elements instead of shrinking the page.
     */
    keepSheetsAboveKeyboard() {
        const vv = window.visualViewport;
        const covering = this.isKeyboardCovering();
        document.querySelectorAll(".phone-sheet:not([hidden])").forEach(sheet => {
            if (covering) {
                const hidden = window.innerHeight - vv.height - vv.offsetTop;
                sheet.style.bottom = `${Math.max(0, hidden)}px`;
                sheet.style.maxHeight = `${vv.height}px`;
            } else {
                sheet.style.bottom = "";
                sheet.style.maxHeight = "";
            }
        });
        const active = document.activeElement;
        if (PhoneLayout.isTextField(active) && active.closest(".phone-sheet")) {
            active.scrollIntoView({block: "nearest"});
        }
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
        // Share only where the browser has a Share menu (Web Share API)
        document.getElementById("phone-share-output").hidden = !navigator.share;
        this.render();
        this.syncBakeButton();
        this.input.update();
        this.app.adjustComponentSizes();
    }


    /**
     * Switches back to the desktop layout.
     */
    leave() {
        this.active = false;
        this.sheets.closeAll();
        this.picker.hideToast();
        // closeAll() finishes on a later popstate; the desktop layout needs the recipe list now
        this.restoreRecipeList();
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
        const focused = list.contains(document.activeElement) ? document.activeElement.dataset.index : null;

        // The operation being edited has gone (removed, or a new recipe was loaded)
        if (this.recListHome && !document.querySelector("#rec-list li.phone-editing")) {
            this.sheets.close();
        }
        list.textContent = "";

        if (!config.length) {
            const empty = document.createElement("li");
            empty.className = "phone-recipe-empty";
            empty.textContent = "No operations yet. Tap + to add one.";
            list.appendChild(empty);
            return;
        }

        config.forEach((op, i) => {
            const li = document.createElement("li");
            li.className = "phone-recipe-op";
            li.dataset.index = i;
            li.textContent = op.op;
            li.tabIndex = 0;
            li.setAttribute("role", "button");
            li.setAttribute("aria-haspopup", "dialog");

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

        if (focused !== null) {
            const again = list.querySelector(`[data-index="${focused}"]`);
            if (again) again.focus({preventScroll: true});
        }
    }


    /**
     * Handler for taps on the recipe strip: opens the tapped operation's argument sheet.
     *
     * @param {Event} e
     */
    stripClick(e) {
        const item = e.target.closest(".phone-recipe-op");
        if (item) this.openArgs(Number(item.dataset.index));
    }


    /**
     * Opens the argument sheet for one operation in the recipe. The sheet shows the real
     * operation element: #rec-list is moved into the sheet and the other operations are
     * hidden, so every argument kind works exactly as on the desktop.
     *
     * @param {number} index - The operation's position in the recipe
     */
    openArgs(index) {
        const recList = document.getElementById("rec-list");
        const op = recList.querySelectorAll("li.operation")[index];
        if (!op || this.recListHome) return;

        this.recListHome = {parent: recList.parentNode, next: recList.nextSibling};
        op.classList.add("phone-editing");
        document.getElementById("phone-arg-title").textContent = op.querySelector(".op-title").textContent;
        document.getElementById("phone-arg-body").appendChild(recList);
        recList.scrollTop = 0;

        // No dragging inside the sheet: the other operations are hidden
        const sortable = Sortable.get(recList);
        if (sortable) sortable.option("disabled", true);

        this.sheets.open(document.getElementById("phone-arg-sheet"), {
            onClose: () => {
                this.restoreRecipeList();
                this.render();
                const item = document.querySelector(`#phone-recipe-ops [data-index="${index}"]`);
                if (item) item.focus({preventScroll: true});
            }
        });
    }


    /**
     * Puts #rec-list back in the desktop recipe pane after the argument sheet. Safe to call
     * when it is already there.
     */
    restoreRecipeList() {
        if (!this.recListHome) return;
        const recList = document.getElementById("rec-list");
        const {parent, next} = this.recListHome;
        parent.insertBefore(recList, next);
        this.recListHome = null;

        recList.querySelectorAll("li.phone-editing").forEach(li => li.classList.remove("phone-editing"));
        const sortable = Sortable.get(recList);
        if (sortable) sortable.option("disabled", false);
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
            switch: "switch",
            about: "support"
        };
        const target = document.getElementById(targets[item.dataset.phoneAction]);
        this.sheets.close();
        if (target) target.click();
    }

}

export default PhoneLayout;
