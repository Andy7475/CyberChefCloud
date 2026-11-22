/**
 * A short message at the bottom of the phone layout, optionally with an Undo button.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

/** How long a message stays up */
const TOAST_MS = 6000;

/**
 * Shows and hides the phone layout's message (#phone-toast).
 */
class PhoneToast {

    /**
     * PhoneToast constructor.
     */
    constructor() {
        this.el = document.getElementById("phone-toast");
        this.action = this.el.querySelector(".phone-toast-action");
        this.onUndo = null;
        this.timer = null;

        this.action.addEventListener("click", () => {
            const undo = this.onUndo;
            this.hide();
            if (undo) undo();
        });
    }


    /**
     * Shows a message.
     *
     * @param {string} text
     * @param {Function} [onUndo] - If given, an Undo button is shown and calls this.
     */
    show(text, onUndo) {
        this.onUndo = onUndo || null;
        this.el.querySelector(".phone-toast-text").textContent = text;
        this.action.hidden = !onUndo;
        this.el.hidden = false;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.hide(), TOAST_MS);
    }


    /**
     * Hides the message.
     */
    hide() {
        clearTimeout(this.timer);
        this.el.hidden = true;
        this.onUndo = null;
    }

}

export default PhoneToast;
