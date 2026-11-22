# Phone layout

Design notes for using CyberChefCloud on a phone. The decisions and the alternatives we rejected are in `docs/adr/0001-own-phone-layout-not-upstream-pr.md` and `docs/adr/0002-captured-audio-as-wav-photos-shrunk.md`. Terms (run screen, recipe strip, argument sheet, …) are defined in `CONTEXT.md`.

## Goals

- Build recipes on a phone: search, add, reorder, disable, delete, and edit arguments with live output.
- Save recipes in the browser, then rerun them on new input.
- Phone-specific input: camera photo, microphone recording, and shared input from other apps.
- Phone-specific output: send the output to other apps with the phone's Share menu.

Not goals: a separate tablet layout (tablets use the desktop layout), porting upstream PR gchq/CyberChef#2187, persisting credentials.

## Platforms

| | Android Chrome | iOS Safari |
| :--- | :--- | :--- |
| Phone layout, camera, microphone, Share output | Yes | Yes |
| Install as an app (PWA), offline local operations | Yes | Yes (Add to Home Screen) |
| Shared input (Web Share Target) | Yes | No: Safari does not support it |
| Password-manager fill/save for `Authenticate Google Cloud` | Yes | No: no `PasswordCredential` |

## When the phone layout is used

`body.mobile` is set when `matchMedia("(max-width: 767px), (pointer: coarse) and (max-height: 499px)")` matches. This is re-checked on resize and rotation. The second condition catches phones in landscape.

Options → **Layout: Auto / Phone / Desktop** overrides the check (stored in `localStorage.options`).

The class goes on `body`, not `:root`, because `OptionsWaiter` replaces `:root.className` when it sets the theme.

## Code

- `src/web/mobile/PhoneLayout.mjs`: chooses the layout, switches between layouts without a reload (the desktop splitters are destroyed on entry and re-created on exit), draws the recipe strip, keeps the floating Bake button in step with `#bake`, and runs the ⋯ menu. `Manager` creates it as `manager.phone` and calls `setup()` from `Manager.setup()`.
- `src/web/mobile/PhoneSheets.mjs`: opens and closes sheets (`.phone-sheet` elements). Each open sheet pushes a history entry. Back, tapping the backdrop, swiping the handle down, and Escape all close the top sheet through `history.back()`. `App.popState` asks `sheets.handlePopState(e)` first, so closing a sheet never reloads the recipe from the URL.
- `src/web/stylesheets/layout/_phone.css`: all phone styling, under `body.mobile`. Phone-only elements have the `phone-only` class and are hidden in the desktop layout.
- Markup is in `src/web/html/index.html`: `#phone-header`, `#phone-recipe-strip` (inside `#IO`, between `#input` and `#output`), `#phone-bake`, `#phone-sheet-backdrop` and `#phone-menu-sheet`. Comments mark where later tickets add buttons.

**Argument sheet:** tapping an operation in the recipe strip calls `PhoneLayout.openArgs(index)`. It moves the desktop `#rec-list` into `#phone-arg-body`, marks the operation with `phone-editing` (CSS hides the others) and disables SortableJS dragging. Closing the sheet moves `#rec-list` back (`restoreRecipeList()`, also called when leaving the phone layout). Because the elements are the desktop ones, the existing argument handlers, auto bake and credential redaction work unchanged. A double tap inside the sheet is stopped before it reaches the desktop's "double-click removes the operation" handler. The sheet closes by itself if its operation disappears (for example when a new recipe is loaded).

**Operation picker:** `src/web/mobile/PhonePicker.mjs`, created by `PhoneLayout` as `manager.phone.picker`. "+" on the recipe strip opens `#phone-picker-sheet`, a full-screen sheet (`phone-sheet-full`, no swipe handle). Search calls the desktop `OperationsWaiter.filterOperations(str, true)`, so matching and highlighting are the same. Adding calls `RecipeWaiter.addOperation`, so `manualBake` and the recipe-change events behave as on the desktop. Taps are ordinary `click` events: the picker's lists are not SortableJS lists, and the browser sends no click after a scroll. Recently used operations are the last 8 added from the picker, in `localStorage.phoneRecentOperations`. The star toggles use `App.addFavourite` / `App.removeFavourite`, the same favourites as the desktop. After adding, `#phone-toast` shows "Added X" with Undo for 6 seconds; Undo removes that operation element.

**Adding a sheet:** add an element with `class="phone-sheet" role="dialog" aria-modal="true" tabindex="-1" hidden`, with a `.phone-sheet-handle` child. Open it with `manager.phone.sheets.open(el, {onClose})`, and close it with `sheets.close()`.

**Adding a ⋯ menu item:** add an `<li><button data-phone-action="…">` to `#phone-menu-items`. Then handle the action in `PhoneLayout.menuClick`, preferably by calling the matching desktop control.

**Floating controls and the keyboard:** `body.phone-typing` is set while a text field has focus and the visual viewport is more than 100px shorter than the window. That happens on iOS when the keyboard is up. Floating controls are hidden while it is set. Open sheets are then moved up to sit inside the visual viewport, and the focused field is scrolled into view (`keepSheetsAboveKeyboard()`). `body.phone-text-focus` is set whenever a text field has focus; the argument sheet uses it to grow from half to nearly full height. On Android, `interactive-widget=resizes-content` shrinks the page instead, so the controls stay above the keyboard.

**Tests:** `tests/browser/03_phone_layout.js` (run screen), `tests/browser/04_phone_argument_sheet.js` (argument sheet) and `tests/browser/05_phone_operation_picker.js` (operation picker; it sends real touch gestures through the Chrome DevTools protocol to check that scrolling never adds an operation). `browserUtils.setPhoneLayout(browser)` sets a 390×844 window and Layout = Phone. `browserUtils.setLayoutOption(browser, value)` sets only the option. Desktop helpers that click hidden desktop controls (such as `clear()` / `setInput()`) don't work in the phone layout, so set input with `window.app.setInput()` and load recipes through the URL hash.

## Screens

### Run screen

```
┌──────────────────────────────┐
│ ☰ My recipes   Edit recipe ⋯ │  header
├──────────────────────────────┤
│ 🖼 photo.jpg · 2.3 MB  ‹1/3› ▾│  input (summary / compact / full)
│ [📷] [🎤] [📋 paste] [📁]      │  input sources
├──────────────────────────────┤
│ [Auth GCloud] [Vision OCR] [+]│  recipe strip (scrolls sideways)
├──────────────────────────────┤
│ output                ⤴ ⧉ ⤓  │  Share / Copy / Save
│ …                            │
│                       (Bake) │  floating Bake button
└──────────────────────────────┘
```

- **Input states:** summary bar → compact (about 25% of the height) → full. Tapping the bar cycles through them. The default is the summary bar when the input is a file or longer than about 20 lines, and compact otherwise. A manual choice holds until the input changes.
- **Multiple inputs:** the existing input tabs, shown as a `‹ n / N ›` switcher in the summary bar.
- **Bake:** auto bake works as on the desktop. Most cloud operations set `manualBake`, which switches auto bake off, so the floating Bake button matters. It shows "Baking…" or a cancel state while a bake runs.
- **⋯ menu:** Options, Save recipe, Load recipe, Clear recipe, Auto Bake toggle, Replace input with output, About.
- **Hidden on the phone:** the desktop banner, notices and splitters.

### Argument sheet

Tapping an operation in the recipe strip opens a half-height sheet showing that operation's arguments. The output stays visible above it and updates live. The sheet shows the real `li.operation` element from `#rec-list`, with the others hidden, so every argument type and the credential icons keep working. While a text field has focus, the sheet expands and the floating Bake button is hidden, because the on-screen keyboard leaves too little room.

### Recipe editor

This is a full-screen view of the existing `#rec-list`, restyled. Each operation has ↑, ↓, disable, breakpoint and delete buttons. There is also a ≡ drag handle: SortableJS `handle`, with `delay` of about 150ms, `delayOnTouchOnly` and `touchStartThreshold` of 5. The buttons are the single-tap alternative to dragging that WCAG 2.2 SC 2.5.7 requires.

### Operation picker

This is a full-screen sheet with the search field focused when it opens. Before you type, it lists favourites and recently used operations, then categories. A single tap adds the operation to the end of the recipe and shows "Added *X* — Undo". SortableJS cancels the synthetic `click` from a finger tap inside sortable lists, so taps there are detected with `pointerdown`/`pointerup`.

### My recipes

This screen lists `localStorage.savedRecipes`, the same data as the desktop Save/Load. Tapping a recipe loads it and returns to the run screen. A row's menu has Rename and Delete. Saved recipes go through `App.redactRecipeConfig`, so a loaded `Authenticate Google Cloud` has empty credentials. Fill them with OAuth sign-in, an access token, or the password manager (Android).

### Shared input

The app opens with the shared text, URL or files in the input. It then shows a picker with **Current recipe** at the top, followed by the saved recipes.

## Navigation

Opening any sheet or screen calls `history.pushState`, so Android Back and the iOS back gesture close it instead of leaving the app. The recipe hash in the URL keeps working as on the desktop.

## Viewport and keyboard

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`. This is missing today, so phones currently render the desktop layout at about 980px wide and shrink it.
- Use `100dvh` for full heights and `env(safe-area-inset-*)` for padding.
- iOS Safari ignores `interactive-widget`. Use `visualViewport` resize events to keep sheets above the keyboard, and hide fixed bottom controls while a text field has focus.

## Captured input

- **Camera:** an `<input type="file" accept="image/*" capture="environment">` opens the native camera. The photo is drawn to a canvas and saved as JPEG with a 2048px long edge, which removes EXIF data. Options → **Camera photo size: 2048px / 4096px / Original**.
- **Microphone:** ● Record, a running timer and ■ Stop, shown in the input area. Audio is captured from `getUserMedia` as PCM through an AudioWorklet, resampled to 16 kHz mono, and written as WAV.
- Both kinds of capture become a file in the input, the same as an upload. Operations never access the hardware.

## PWA and shared input

- `manifest.webmanifest` and a service worker, both scoped to the GitHub Pages subpath.
- **Service worker cache:** `index.html` is fetched network-first, and the app's other files are cached. Local operations and local models then work offline. Google API requests are never cached.
- **Share target:** `share_target` with `method: POST` and `enctype: multipart/form-data`, accepting text, url and files (`image/*`, `audio/*`, `application/pdf`, `text/*`). The service worker receives the POST, keeps the data until the page loads, and redirects to the app, which puts the data in the input.
- **CSP:** `index.html` may need `worker-src` and `manifest-src`. Check and update `docs/AuthorizedEndpoints.md`.

## Delivery

Each item is a separate PR, in this order:

1. Phone layout: viewport meta tag, layout detection and override, run screen, argument sheet, recipe editor, operation picker, Back handling, Share/Copy/Save output.
2. My recipes.
3. PWA: manifest and service worker, offline use.
4. Shared input (needs 3).
5. Captured input: camera and microphone (needs 1 only).

## Testing

- **Automated:** Nightwatch at a 390×844 viewport with the phone layout forced on. Cover searching and adding an operation, Undo, editing an argument and seeing live output, reordering with the buttons, disabling and deleting, baking, saving, loading from My recipes, and Back closing a sheet.
- **Screenshots:** Playwright device emulation (Pixel 7, iPhone 14) in both themes, for reviewing the layout.
- **Manual device checklist:** these can't be automated.
  - [ ] Install from Chrome on Android, then open from the home screen.
  - [ ] Share an image from Photos to CyberChefCloud, choose a saved OCR recipe, and check the output.
  - [ ] Share text and a URL; check that Current recipe runs.
  - [ ] Take a camera photo; check the size and that the EXIF GPS data is gone (for example with `Extract EXIF`).
  - [ ] Record 10 s of speech and run Speech-to-Text on Android and on iOS.
  - [ ] Complete `Authenticate Google Cloud` with an OAuth sign-in in the browser and in the installed app.
  - [ ] Fill credentials from the password manager (Android).
  - [ ] Typing in an argument with the keyboard open keeps the field visible (Android and iOS).
  - [ ] Rotate to landscape; the phone layout stays in use.
  - [ ] Go offline; local operations still bake.
  - [ ] Share output to another app.
