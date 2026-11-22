/**
 * Sheets for the phone layout: panels that slide up over the run screen.
 *
 * Every open sheet has its own browser history entry, so Android Back (or the iOS back
 * gesture) closes the top sheet instead of leaving the page. Closing a sheet any other
 * way (tapping outside it, swiping it down, Escape, or code) goes through history.back(),
 * so the history stack and the sheet stack always match.
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

const SWIPE_CLOSE_DISTANCE = 80;

/**
 * Opens and closes phone-layout sheets and keeps them in step with browser history.
 */
class PhoneSheets {

    /**
     * PhoneSheets constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     */
    constructor(app) {
        this.app = app;
        this.backdrop = document.getElementById("phone-sheet-backdrop");
        /** @type {{sheet: HTMLElement, returnFocus: Element, onClose: Function}[]} */
        this.stack = [];
        // history.back() calls made by close() whose popstate has not arrived yet
        this.closing = 0;
        // Number of sheets to hide on the next popstate after closeAll()'s history.go(-n)
        this.bulkClose = 0;

        this.backdrop.addEventListener("click", () => this.close());
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && this.stack.length) {
                e.stopPropagation();
                this.close();
            }
        }, true);
    }


    /**
     * Whether any sheet is open.
     *
     * @returns {boolean}
     */
    isOpen() {
        return this.stack.length > 0;
    }


    /**
     * Opens a sheet on top of any already open.
     *
     * @param {HTMLElement} sheet - An element with the `phone-sheet` class.
     * @param {Object} [opts]
     * @param {Function} [opts.onClose] - Called after the sheet has closed.
     */
    open(sheet, {onClose} = {}) {
        if (this.stack.some(entry => entry.sheet === sheet)) return;

        this.stack.push({sheet, returnFocus: document.activeElement, onClose});
        window.history.pushState({phoneSheet: sheet.id}, "", window.location.href);

        sheet.hidden = false;
        sheet.style.zIndex = 1050 + this.stack.length * 2;
        this.backdrop.style.zIndex = 1049 + this.stack.length * 2;
        this.backdrop.hidden = false;
        this.syncBackdrop();
        this.bindSwipe(sheet);

        const first = sheet.querySelector("button, [href], input, select, textarea");
        (first || sheet).focus({preventScroll: true});
    }


    /**
     * Closes the top sheet by going back one history entry.
     * The sheet is hidden when the resulting popstate event arrives.
     */
    close() {
        if (this.stack.length - this.closing <= 0) return;
        this.closing++;
        window.history.back();
    }


    /**
     * Closes every open sheet at once. Used when leaving the phone layout.
     */
    closeAll() {
        const n = this.stack.length - this.closing;
        if (n <= 0) return;
        this.bulkClose = this.stack.length;
        this.closing = 0;
        window.history.go(-n);
    }


    /**
     * Handles a history popstate event. Called by App.popState before it reloads the URL.
     *
     * @param {PopStateEvent} e
     * @returns {boolean} True if the event belonged to the phone layout and the app should
     *   not reload state from the URL.
     */
    handlePopState(e) {
        if (this.stack.length) {
            // history.go(-n) delivers a single popstate however many entries it skips;
            // each history.back() delivers its own
            let toClose = 1;
            if (this.bulkClose) {
                toClose = this.bulkClose;
                this.bulkClose = 0;
            } else if (this.closing) {
                this.closing--;
            }
            for (let i = 0; i < toClose && this.stack.length; i++) {
                this.hideTop();
            }
            // The app may have replaced the sheet's history entry with a newer recipe URL
            // while the sheet was open, so write the current state back to this entry.
            this.app.updateURL(true, null, true);
            return true;
        }
        // Forward navigation onto an old sheet entry: nothing to reopen
        return Boolean(e.state && e.state.phoneSheet);
    }


    /**
     * Hides the top sheet and restores focus to where it was before the sheet opened.
     */
    hideTop() {
        const {sheet, returnFocus, onClose} = this.stack.pop();
        sheet.hidden = true;
        sheet.style.transform = "";
        sheet.style.bottom = "";
        sheet.style.maxHeight = "";

        if (this.stack.length) {
            this.backdrop.style.zIndex = 1049 + this.stack.length * 2;
            this.syncBackdrop();
        } else {
            this.backdrop.hidden = true;
        }

        if (returnFocus && typeof returnFocus.focus === "function" && document.contains(returnFocus)) {
            returnFocus.focus({preventScroll: true});
        }
        if (onClose) onClose();
    }


    /**
     * Makes the backdrop see-through when the top sheet has `data-backdrop="clear"`, for sheets
     * that leave the output visible above them (the argument sheet). Tapping it still closes the sheet.
     */
    syncBackdrop() {
        const top = this.stack[this.stack.length - 1];
        this.backdrop.classList.toggle("phone-backdrop-clear", Boolean(top && top.sheet.dataset.backdrop === "clear"));
    }


    /**
     * Lets the user close a sheet by dragging its handle downwards.
     *
     * @param {HTMLElement} sheet
     */
    bindSwipe(sheet) {
        if (sheet.dataset.swipeBound) return;
        sheet.dataset.swipeBound = "true";

        // Full-screen sheets have no handle; they close with their own button or Back
        const handle = sheet.querySelector(".phone-sheet-handle");
        if (!handle) return;
        let startY = null;

        handle.addEventListener("pointerdown", e => {
            startY = e.clientY;
            handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener("pointermove", e => {
            if (startY === null) return;
            const dy = Math.max(0, e.clientY - startY);
            sheet.style.transform = `translateY(${dy}px)`;
        });
        const end = e => {
            if (startY === null) return;
            const dy = e.clientY - startY;
            startY = null;
            sheet.style.transform = "";
            if (dy > SWIPE_CLOSE_DISTANCE) this.close();
        };
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
    }

}

export default PhoneSheets;
