/**
 * The phone layout's saved recipes: Save recipe (⋯ menu) and the My recipes screen, with
 * load, rename and delete.
 *
 * Saved recipes are the desktop's: `localStorage.savedRecipes`, an array of
 * {id, name, recipe}, where `name` is HTML-escaped and `recipe` is a recipe config string,
 * and `localStorage.recipeId` holds the last id used. Recipes are redacted with
 * App.redactRecipeConfig before saving, so keys and tokens are never stored.
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

import Utils from "../../core/Utils.mjs";

/**
 * Controls Save recipe and the My recipes screen.
 */
class PhoneRecipes {

    /**
     * PhoneRecipes constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     * @param {PhoneSheets} sheets - The phone layout's sheets.
     * @param {PhoneToast} toast - The phone layout's message bar.
     */
    constructor(app, manager, sheets, toast) {
        this.app = app;
        this.manager = manager;
        this.sheets = sheets;
        this.toast = toast;
        // The saved recipe the row menu or the name sheet is acting on
        this.current = null;
        // "save" or "rename"
        this.nameMode = "save";
    }


    /**
     * Finds the elements and sets up the listeners.
     */
    setup() {
        this.screen = document.getElementById("phone-recipes-sheet");
        this.list = document.getElementById("phone-recipes-list");
        this.nameSheet = document.getElementById("phone-name-sheet");
        this.nameInput = document.getElementById("phone-name-input");
        this.rowSheet = document.getElementById("phone-recipe-row-sheet");

        document.getElementById("phone-recipes-btn").addEventListener("click", () => this.open());
        document.getElementById("phone-recipes-back").addEventListener("click", () => this.sheets.close());

        this.list.addEventListener("click", e => {
            const more = e.target.closest(".phone-recipe-more");
            if (more) {
                this.openRowMenu(Number(more.dataset.id));
                return;
            }
            const load = e.target.closest(".phone-recipe-load");
            if (load) this.load(Number(load.dataset.id));
        });

        document.getElementById("phone-name-form").addEventListener("submit", e => {
            e.preventDefault();
            this.submitName();
        });
        document.getElementById("phone-recipe-rename").addEventListener("click", () => {
            const recipe = this.current;
            this.sheets.close();
            this.openName("rename", recipe);
        });
        document.getElementById("phone-recipe-delete").addEventListener("click", () => {
            const recipe = this.current;
            this.sheets.close();
            this.remove(recipe);
        });
    }


    /**
     * Reads the saved recipes.
     *
     * @returns {{id: number, name: string, recipe: string}[]}
     */
    read() {
        try {
            const list = JSON.parse(localStorage.savedRecipes || "[]");
            return Array.isArray(list) ? list : [];
        } catch (err) {
            return [];
        }
    }


    /**
     * Writes the saved recipes.
     *
     * @param {{id: number, name: string, recipe: string}[]} list
     */
    write(list) {
        localStorage.savedRecipes = JSON.stringify(list);
    }


    /**
     * The operation names in a saved recipe, for its row in the list.
     *
     * @param {string} recipe - A saved recipe config string
     * @returns {string}
     */
    static describe(recipe) {
        try {
            return Utils.parseRecipeConfig(recipe).map(op => op.op).join(" → ");
        } catch (err) {
            return "";
        }
    }


    /**
     * Opens the My recipes screen.
     */
    open() {
        this.render();
        this.sheets.open(this.screen);
    }


    /**
     * Lists the saved recipes, newest first.
     */
    render() {
        const recipes = this.read().slice().reverse();
        this.list.textContent = "";
        document.getElementById("phone-recipes-empty").hidden = recipes.length > 0;

        recipes.forEach(r => {
            const name = Utils.unescapeHtml(r.name);
            const li = document.createElement("li");
            li.className = "phone-pick-row";

            const load = document.createElement("button");
            load.type = "button";
            load.className = "phone-pick phone-recipe-load";
            load.dataset.id = r.id;
            load.setAttribute("aria-label", `Load ${name}`);
            const title = document.createElement("span");
            title.className = "phone-pick-name";
            title.textContent = name;
            const desc = document.createElement("span");
            desc.className = "phone-pick-desc";
            desc.textContent = PhoneRecipes.describe(r.recipe);
            load.append(title, desc);

            const more = document.createElement("button");
            more.type = "button";
            more.className = "phone-icon-btn phone-recipe-more";
            more.dataset.id = r.id;
            more.setAttribute("aria-label", `More actions for ${name}`);
            more.setAttribute("aria-haspopup", "dialog");
            more.innerHTML = "<i class='material-icons' aria-hidden='true'>more_vert</i>";

            li.append(load, more);
            this.list.appendChild(li);
        });
    }


    /**
     * Loads a saved recipe through the normal recipe-config loading, and returns to the run screen.
     *
     * @param {number} id
     */
    load(id) {
        const recipe = this.read().find(r => r.id === id);
        if (!recipe) return;
        try {
            const config = Utils.parseRecipeConfig(recipe.recipe);
            this.app.setRecipeConfig(config);
            this.app.autoBake();
        } catch (err) {
            this.app.alert("This saved recipe could not be read.", 3000);
            return;
        }
        this.sheets.closeAll();
        this.toast.show(`Loaded ${Utils.unescapeHtml(recipe.name)}`);
    }


    /**
     * Opens the Save recipe sheet, with a name suggested from the operations.
     */
    openSave() {
        const config = this.app.getRecipeConfig();
        if (!config.length) {
            this.app.alert("Add an operation before saving the recipe.", 3000);
            return;
        }
        this.openName("save", null);
    }


    /**
     * Opens the name sheet, to save the current recipe or rename a saved one.
     *
     * @param {string} mode - "save" or "rename"
     * @param {Object} [recipe] - The saved recipe to rename
     */
    openName(mode, recipe) {
        this.nameMode = mode;
        this.current = recipe;
        const rename = mode === "rename";
        document.getElementById("phone-name-title").textContent = rename ? "Rename recipe" : "Save recipe";
        document.getElementById("phone-name-submit").textContent = rename ? "Rename" : "Save";
        this.nameInput.value = rename ?
            Utils.unescapeHtml(recipe.name) :
            this.app.getRecipeConfig().map(op => op.op).join(", ").slice(0, 60);
        this.sheets.open(this.nameSheet);
        this.nameInput.focus();
        this.nameInput.select();
    }


    /**
     * Saves or renames, from the name sheet.
     */
    submitName() {
        const name = this.nameInput.value.trim();
        if (!name) return;
        if (!this.app.isLocalStorageAvailable()) {
            this.app.alert("Your security settings do not allow local storage, so recipes cannot be saved.", 5000);
            return;
        }

        const list = this.read();
        if (this.nameMode === "rename") {
            const recipe = list.find(r => this.current && r.id === this.current.id);
            if (recipe) recipe.name = Utils.escapeHtml(name);
            this.write(list);
            this.sheets.close();
            this.render();
            return;
        }

        const config = this.app.redactRecipeConfig(this.app.getRecipeConfig());
        const id = Number(localStorage.recipeId || 0) + 1;
        list.push({id, name: Utils.escapeHtml(name), recipe: JSON.stringify(config)});
        this.write(list);
        localStorage.recipeId = id;
        this.sheets.close();
        this.toast.show(`Saved as ${name}`);
    }


    /**
     * Opens a saved recipe's menu (Rename, Delete).
     *
     * @param {number} id
     */
    openRowMenu(id) {
        this.current = this.read().find(r => r.id === id);
        if (!this.current) return;
        document.getElementById("phone-recipe-row-title").textContent = Utils.unescapeHtml(this.current.name);
        this.sheets.open(this.rowSheet);
    }


    /**
     * Deletes a saved recipe, with Undo.
     *
     * @param {Object} recipe
     */
    remove(recipe) {
        if (!recipe) return;
        const list = this.read();
        const index = list.findIndex(r => r.id === recipe.id);
        if (index < 0) return;
        list.splice(index, 1);
        this.write(list);
        this.render();
        this.toast.show(`Deleted ${Utils.unescapeHtml(recipe.name)}`, () => {
            const now = this.read();
            now.splice(Math.min(index, now.length), 0, recipe);
            this.write(now);
            this.render();
        });
    }

}

export default PhoneRecipes;
