/**
 * The phone layout's recipe editor: a full-screen view of the whole recipe, where operations
 * can be moved up and down (or dragged by their ≡ handle), disabled, given a breakpoint and
 * deleted. Tapping an operation's name shows or hides its arguments in place.
 *
 * Like the argument sheet, the editor shows the desktop #rec-list itself, moved into the sheet
 * while it is open, so the recipe, URL and bake update exactly as after desktop edits.
 * Design: docs/MobileUI.md and docs/adr/0001-own-phone-layout-not-upstream-pr.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Sortable from "sortablejs";

/** A tap moves less than this many pixels; anything more is a scroll or a drag */
const TAP_SLOP = 10;

/**
 * Controls the recipe editor.
 */
class PhoneEditor {

    /**
     * PhoneEditor constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     * @param {PhoneLayout} layout - The phone layout, for its sheets and argument sheet.
     */
    constructor(app, manager, layout) {
        this.app = app;
        this.manager = manager;
        this.layout = layout;
        // Where #rec-list lives in the desktop layout, while it is in the editor
        this.home = null;
        this.tapStart = null;
    }


    /**
     * Finds the elements and sets up the listeners.
     */
    setup() {
        this.sheet = document.getElementById("phone-editor-sheet");
        this.body = document.getElementById("phone-editor-body");

        document.getElementById("phone-editor-btn").addEventListener("click", () => this.open());
        document.getElementById("phone-editor-back").addEventListener("click", () => this.layout.sheets.close());
        document.getElementById("phone-editor-add").addEventListener("click", () => this.layout.picker.open());

        this.body.addEventListener("click", e => {
            const button = e.target.closest(".phone-op-controls button");
            if (button) this.controlClick(button);
        });

        // SortableJS cancels the click that follows a finger tap inside its list, so a tap on an
        // operation's name is detected from pointer events instead
        this.body.addEventListener("pointerdown", e => {
            if (!e.target.closest(".phone-editor-body #rec-list .op-title")) return;
            this.tapStart = {x: e.clientX, y: e.clientY, op: e.target.closest("li.operation")};
        });
        this.body.addEventListener("pointerup", e => {
            const start = this.tapStart;
            this.tapStart = null;
            if (!start || !e.target.closest(".op-title")) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
            this.toggleArgs(start.op);
        });
        this.body.addEventListener("pointercancel", () => {
            this.tapStart = null;
        });
        this.body.addEventListener("keydown", e => {
            const title = e.target.closest(".op-title");
            if (title && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                this.toggleArgs(title.closest("li.operation"));
            }
        });
        // Double-clicking an operation removes it on the desktop; here a double tap is an accident
        this.sheet.addEventListener("dblclick", e => e.stopPropagation(), true);

        // Operations added while the editor is open (with +) get their controls too
        new MutationObserver(() => {
            if (this.home) this.decorate();
        }).observe(document.getElementById("rec-list"), {childList: true});
    }


    /**
     * Opens the recipe editor.
     */
    open() {
        if (this.home) return;
        const recList = document.getElementById("rec-list");
        this.home = {parent: recList.parentNode, next: recList.nextSibling};
        this.body.appendChild(recList);
        this.decorate();

        // Drag only from the ≡ handle, after a short hold on touch, so swiping scrolls the list
        const sortable = Sortable.get(recList);
        if (sortable) {
            sortable.option("handle", ".phone-op-handle");
            sortable.option("delay", 150);
            sortable.option("delayOnTouchOnly", true);
            sortable.option("touchStartThreshold", 5);
        }

        this.layout.sheets.open(this.sheet, {onClose: () => this.restore()});
    }


    /**
     * Puts #rec-list back in the desktop recipe pane and restores the desktop drag behaviour.
     * Safe to call when the editor is not open.
     */
    restore() {
        if (!this.home) return;
        const recList = document.getElementById("rec-list");
        const {parent, next} = this.home;
        this.home = null;
        parent.insertBefore(recList, next);
        recList.querySelectorAll(".phone-op-controls").forEach(el => el.remove());
        recList.querySelectorAll("li.phone-expanded").forEach(li => li.classList.remove("phone-expanded"));
        recList.querySelectorAll(".op-title[tabindex]").forEach(el => {
            el.removeAttribute("tabindex");
            el.removeAttribute("role");
            el.removeAttribute("aria-label");
        });

        const sortable = Sortable.get(recList);
        if (sortable) {
            sortable.option("handle", null);
            sortable.option("delay", 0);
            sortable.option("delayOnTouchOnly", false);
            sortable.option("touchStartThreshold", 0);
        }
        this.layout.render();
    }


    /**
     * Adds the phone controls to every operation that does not have them, and brings their
     * names and states up to date.
     */
    decorate() {
        const ops = Array.from(document.querySelectorAll("#rec-list li.operation"));
        document.getElementById("phone-editor-empty").hidden = ops.length > 0;

        ops.forEach((li, i) => {
            const name = li.querySelector(".op-title").textContent;
            let controls = li.querySelector(":scope > .phone-op-controls");
            if (!controls) {
                controls = document.createElement("div");
                controls.className = "phone-op-controls";
                controls.innerHTML = `
                    <button type="button" class="phone-icon-btn" data-action="up"><i class="material-icons" aria-hidden="true">arrow_upward</i></button>
                    <button type="button" class="phone-icon-btn" data-action="down"><i class="material-icons" aria-hidden="true">arrow_downward</i></button>
                    <button type="button" class="phone-icon-btn" data-action="disable"><i class="material-icons" aria-hidden="true">not_interested</i></button>
                    <button type="button" class="phone-icon-btn" data-action="breakpoint"><i class="material-icons" aria-hidden="true">pause</i></button>
                    <button type="button" class="phone-icon-btn" data-action="delete"><i class="material-icons" aria-hidden="true">delete</i></button>
                    <span class="phone-op-handle" aria-hidden="true"><i class="material-icons">drag_handle</i></span>`;
                li.appendChild(controls);
            }

            const title = li.querySelector(".op-title");
            title.tabIndex = 0;
            title.setAttribute("role", "button");
            title.setAttribute("aria-label", `${name}: ${li.classList.contains("phone-expanded") ? "hide" : "show"} arguments`);
            title.setAttribute("aria-expanded", String(li.classList.contains("phone-expanded")));

            const disabled = li.classList.contains("disabled");
            const breakpoint = li.querySelector(".breakpoint").getAttribute("break") === "true";
            const set = (action, label, pressed) => {
                const button = controls.querySelector(`[data-action="${action}"]`);
                button.setAttribute("aria-label", label);
                if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
            };
            set("up", `Move ${name} up`);
            set("down", `Move ${name} down`);
            set("disable", `Disable ${name}`, disabled);
            set("breakpoint", `Breakpoint on ${name}`, breakpoint);
            set("delete", `Delete ${name}`);
            controls.querySelector("[data-action='up']").disabled = i === 0;
            controls.querySelector("[data-action='down']").disabled = i === ops.length - 1;
        });
    }


    /**
     * Handles a tap on one of an operation's controls.
     *
     * @param {HTMLButtonElement} button
     */
    controlClick(button) {
        const li = button.closest("li.operation");
        const recList = document.getElementById("rec-list");
        switch (button.dataset.action) {
            case "up":
                if (li.previousElementSibling) {
                    recList.insertBefore(li, li.previousElementSibling);
                    this.moved(li, "up");
                }
                break;
            case "down":
                if (li.nextElementSibling) {
                    recList.insertBefore(li.nextElementSibling, li);
                    this.moved(li, "down");
                }
                break;
            case "disable":
                li.querySelector(".disable-icon").click();
                this.decorate();
                break;
            case "breakpoint":
                li.querySelector(".breakpoint").click();
                this.decorate();
                break;
            case "delete":
                li.remove();
                recList.dispatchEvent(this.manager.operationremove);
                this.decorate();
                break;
        }
    }


    /**
     * After a move: tell the app, as a desktop drag does, and keep focus on the moved button.
     *
     * @param {HTMLElement} li - The operation that moved
     * @param {string} direction - "up" or "down"
     */
    moved(li, direction) {
        this.app.progress = 0;
        document.dispatchEvent(this.manager.statechange);
        this.decorate();
        const button = li.querySelector(`[data-action="${direction}"]`);
        (button.disabled ? li.querySelector(".op-title") : button).focus({preventScroll: true});
        li.scrollIntoView({block: "nearest"});
    }


    /**
     * Shows or hides an operation's arguments in the editor, so they can be changed in place.
     *
     * @param {HTMLElement} li
     */
    toggleArgs(li) {
        if (!li) return;
        li.classList.toggle("phone-expanded");
        this.decorate();
        if (li.classList.contains("phone-expanded")) li.scrollIntoView({block: "nearest"});
    }

}

export default PhoneEditor;
