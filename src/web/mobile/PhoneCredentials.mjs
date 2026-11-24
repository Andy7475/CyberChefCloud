/**
 * Saved profiles in the phone's password manager, for operations with sensitive arguments
 * (such as Authenticate Google Cloud).
 *
 * On the desktop the key icons use the Credential Management API (PasswordCredential). Chrome on
 * Android sends that API to Android's credential manager, which can fail with "An unknown error
 * occurred while talking to the credential manager" and does not reliably offer to save. So in the
 * phone layout the icons open a real sign-in form instead: the profile name is the username and
 * the operation's settings (JSON, see RecipeWaiter.savedProfileFor) are the password. Password
 * managers offer to save a submitted form, and fill it from the keyboard's suggestions.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

/**
 * Runs the save and fill profile sheet.
 */
class PhoneCredentials {

    /**
     * PhoneCredentials constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     * @param {PhoneLayout} layout - The phone layout, for its sheets and toast.
     */
    constructor(app, manager, layout) {
        this.app = app;
        this.manager = manager;
        this.layout = layout;
        this.mode = "save";
        this.item = null;
    }


    /**
     * Takes over the key icons in the phone layout, and sets up the form.
     */
    setup() {
        this.sheet = document.getElementById("phone-profile-sheet");
        this.form = document.getElementById("phone-profile-form");
        this.name = document.getElementById("phone-profile-name");
        this.secret = document.getElementById("phone-profile-secret");

        // Capture phase: runs before, and stops, the desktop handlers on these icons
        document.addEventListener("click", e => {
            if (!this.layout.active) return;
            const icon = e.target.closest(".save-creds-icon, .fill-creds-icon");
            if (!icon) return;
            e.stopPropagation();
            e.preventDefault();
            this.open(icon.classList.contains("save-creds-icon") ? "save" : "fill", icon.closest("li.operation"));
        }, true);

        this.form.addEventListener("submit", e => {
            e.preventDefault();
            this.submit();
        });
    }


    /**
     * Opens the profile sheet.
     *
     * @param {string} mode - "save" or "fill"
     * @param {HTMLElement} item - The recipe operation element
     */
    open(mode, item) {
        this.mode = mode;
        this.item = item;
        const save = mode === "save";
        document.getElementById("phone-profile-title").textContent = save ? "Save to password manager" : "Fill from password manager";
        document.getElementById("phone-profile-help").textContent = save ?
            "Give this profile a name (for example the project ID) and tap Save. Your password manager should then offer to save it." :
            "Tap Profile name and choose a saved profile from the suggestions above the keyboard, then tap Fill.";
        document.getElementById("phone-profile-submit").textContent = save ? "Save" : "Fill";
        this.name.value = "";
        this.secret.value = save ? this.manager.recipe.savedProfileFor(item) : "";
        this.secret.readOnly = false;
        this.layout.sheets.open(this.sheet, {onClose: () => this.clear()});
    }


    /**
     * Handles the form: for Save, the submit itself is what the password manager watches for;
     * for Fill, the filled settings are applied to the operation.
     */
    submit() {
        const name = this.name.value.trim();
        if (this.mode === "save") {
            if (!name) return;
            this.layout.sheets.close();
            this.layout.toast.show(`If no "Save password?" prompt appeared, check that Chrome's "Offer to save passwords" is on (not in Incognito).`);
            return;
        }
        if (!this.secret.value) {
            this.app.alert("Choose a saved profile from the suggestions first.", 4000);
            return;
        }
        if (this.manager.recipe.applySavedProfile(this.item, this.secret.value, name || "saved profile")) {
            this.layout.sheets.close();
        }
    }


    /**
     * Removes the settings from the form once the sheet has closed.
     */
    clear() {
        // Leave the values long enough for the password manager to read the submitted form
        setTimeout(() => {
            this.name.value = "";
            this.secret.value = "";
        }, 1000);
        this.item = null;
    }

}

export default PhoneCredentials;
