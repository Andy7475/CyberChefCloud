/**
 * The phone layout's input bar: a summary of the input, three sizes for the input area
 * (summary, compact, full), a ‹ n / N › switcher for multiple inputs, and the input-source row
 * (Paste, Open file, Camera, Microphone).
 *
 * Captured input (camera, microphone) and opened files all reach the input through one
 * function, loadFiles(), which uses the desktop's file-upload path (InputWaiter.loadUIFiles).
 * Design: docs/MobileUI.md
 *
 * @author CyberChefCloud
 * @copyright Crown Copyright 2026
 * @license Apache-2.0
 */

/** The input area sizes, in the order a tap on the bar cycles through them */
const STATES = ["summary", "compact", "full"];
/** Text with more lines than this starts as the summary bar */
const LONG_TEXT_LINES = 20;

const TYPE_ICONS = [
    [/^image\//, "image"],
    [/^audio\//, "audiotrack"],
    [/^video\//, "movie"],
    [/pdf$/, "picture_as_pdf"]
];

/**
 * Controls the phone layout's input bar.
 */
class PhoneInput {

    /**
     * PhoneInput constructor.
     *
     * @param {App} app - The main view object for CyberChef.
     * @param {Manager} manager - The CyberChef event manager.
     */
    constructor(app, manager) {
        this.app = app;
        this.manager = manager;
        this.state = "compact";
        // The state the user chose, which holds until the input changes
        this.manual = null;
        // Identifies the current input content, to notice when it changes
        this.contentKey = null;
        this.updateTimer = null;
        // When the user last typed or pasted in the editor
        this.lastEdit = 0;
    }


    /**
     * Finds the bar's elements and sets up its listeners.
     */
    setup() {
        this.input = document.getElementById("input");
        this.toggle = document.getElementById("phone-input-toggle");
        this.fileInput = document.getElementById("phone-open-file");

        this.toggle.addEventListener("click", () => this.cycle());
        document.getElementById("phone-input-prev").addEventListener("click", () => this.manager.input.changeTabLeft());
        document.getElementById("phone-input-next").addEventListener("click", () => this.manager.input.changeTabRight());
        document.getElementById("phone-input-clear").addEventListener("click", () => document.getElementById("clr-io").click());
        document.getElementById("phone-input-paste").addEventListener("click", () => this.paste());
        document.getElementById("phone-input-file").addEventListener("click", () => this.fileInput.click());
        this.fileInput.addEventListener("change", () => {
            if (this.fileInput.files.length) this.loadFiles(this.fileInput.files);
            this.fileInput.value = "";
        });

        // CyberChef focuses the editor itself when the input changes, so focus does not mean the
        // user is typing; recent key and edit events in the editor do
        const editor = document.getElementById("input-text");
        ["keydown", "beforeinput", "paste", "drop"].forEach(type =>
            editor.addEventListener(type, () => {
                this.lastEdit = Date.now();
            }, true));

        // The editor's content, the file details panel and the input tabs all live in these
        // elements, so watching them catches typing, loading, files and tab changes
        const observer = new MutationObserver(() => this.queueUpdate());
        const opts = {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"]};
        observer.observe(document.getElementById("input-text"), opts);
        observer.observe(document.getElementById("input-tabs"), opts);
    }


    /**
     * Puts files into the input through the desktop's file-upload path. Open file uses it,
     * and so do captured photos (#21) and recordings (#22), which pass a generated File.
     *
     * @param {File[]|FileList} files
     */
    loadFiles(files) {
        this.manual = null;
        this.lastEdit = 0;
        this.manager.input.loadUIFiles(Array.from(files));
    }


    /**
     * Replaces the input with the text on the clipboard.
     */
    async paste() {
        try {
            const text = await navigator.clipboard.readText();
            this.manual = null;
            this.lastEdit = 0;
            this.app.setInput(text);
        } catch (err) {
            this.app.alert("The clipboard could not be read. Long-press in the input to paste instead.", 4000);
        }
    }


    /**
     * Moves to the next input area size, and keeps it until the input changes.
     */
    cycle() {
        this.manual = STATES[(STATES.indexOf(this.state) + 1) % STATES.length];
        this.apply(this.manual);
    }


    /**
     * Updates the bar after the input changes, at most once every 100ms.
     */
    queueUpdate() {
        if (!document.body.classList.contains("mobile")) return;
        clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => this.update(), 100);
    }


    /**
     * Describes the active input for the summary bar.
     *
     * @returns {{isFile: boolean, icon: string, summary: string, label: string, lines: number, key: string}}
     */
    describe() {
        const tab = this.manager.tabs.getActiveTab("input");
        const details = this.manager.input.fileDetails;
        const isFile = Boolean(document.querySelector("#input-text .cm-file-details") && details && details.fileDetails);

        if (isFile) {
            const {name, size, type} = details.fileDetails;
            const match = TYPE_ICONS.find(([re]) => re.test(type || ""));
            const sizeStr = PhoneInput.formatSize(size);
            return {
                isFile,
                icon: match ? match[1] : "insert_drive_file",
                summary: `${name} · ${sizeStr}`,
                label: `File ${name}, ${type || "unknown type"}, ${sizeStr}`,
                lines: 0,
                key: `${tab}|file|${name}|${size}`
            };
        }

        const doc = this.manager.input.inputEditorView.state.doc;
        const firstLine = doc.sliceString(0, 200).split(/\r?\n|\r/).find(line => line.trim()) || "";
        const length = doc.length;
        return {
            isFile,
            icon: "notes",
            summary: length ? `${firstLine.trim()} · ${length} chars` : "Empty input",
            label: length ? `Text, ${length} characters, ${doc.lines} lines` : "Empty input",
            lines: doc.lines,
            key: `${tab}|text|${length}|${doc.sliceString(0, 200)}`
        };
    }


    /**
     * Brings the bar up to date with the input: summary text, size and switcher.
     */
    update() {
        const info = this.describe();
        const typing = Date.now() - this.lastEdit < 1000;

        if (info.key !== this.contentKey) {
            // Typing changes the content too, but should not resize the area being typed in
            if (!typing) this.manual = null;
            this.contentKey = info.key;
        }

        this.toggle.querySelector(".phone-input-type").textContent = info.icon;
        this.toggle.querySelector(".phone-input-summary").textContent = info.summary;
        this.info = info;

        let state = this.manual;
        if (!state) {
            state = typing ? this.state : (info.isFile || info.lines > LONG_TEXT_LINES ? "summary" : "compact");
        }
        this.apply(state);
        this.updateSwitcher();
    }


    /**
     * Shows the input area at one of its sizes.
     *
     * @param {string} state - "summary", "compact" or "full"
     */
    apply(state) {
        this.state = state;
        this.input.dataset.phoneState = state;
        this.toggle.setAttribute("aria-expanded", String(state !== "summary"));
        this.toggle.querySelector(".phone-input-state").textContent =
            {summary: "expand_more", compact: "unfold_more", full: "expand_less"}[state];
        const label = this.info ? this.info.label : "Input";
        this.toggle.setAttribute("aria-label", `Input: ${label}. Size: ${state}. Tap to change the size.`);
        this.app.adjustComponentSizes();
    }


    /**
     * Shows the ‹ n / N › switcher when there is more than one input.
     */
    async updateSwitcher() {
        const {inputNums} = await this.manager.input.getInputNums();
        const nums = inputNums.map(Number).sort((a, b) => a - b);
        const position = nums.indexOf(this.manager.tabs.getActiveTab("input")) + 1;
        const switcher = document.getElementById("phone-input-switcher");

        switcher.hidden = nums.length < 2;
        document.getElementById("phone-input-position").textContent = `${position} / ${nums.length}`;
        document.getElementById("phone-input-position").setAttribute("aria-label", `Input ${position} of ${nums.length}`);
    }


    /**
     * Formats a size in bytes for people.
     *
     * @param {number} bytes
     * @returns {string}
     */
    static formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        const units = ["KB", "MB", "GB"];
        let size = bytes / 1024, i = 0;
        while (size >= 1024 && i < units.length - 1) {
            size /= 1024;
            i++;
        }
        return `${size.toFixed(size < 10 ? 1 : 0)} ${units[i]}`;
    }

}

export default PhoneInput;
