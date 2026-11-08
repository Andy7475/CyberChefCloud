# Homoglyph detection

Tools for spotting characters that look like ASCII but are not, such as the Cyrillic `а` (U+0430) in a phishing URL `pаypal.com`.

## Editor setting: colour-code characters

**Options → "Colour-code characters in the input and output to expose homoglyphs"** (off by default; option key `charHighlight`).

When it is on, the input and output editors colour every character by class:

| Class | Example | Light theme | Notes |
| :--- | :--- | :--- | :--- |
| ASCII letter | `abc` | blue | |
| ASCII digit | `123` | red | |
| ASCII symbol | `.-/@` | purple | |
| Homoglyph | `а` `ｇ` `𝐚` | dark green, bold, green background | Non-ASCII character listed as confusable with ASCII |
| Accented letter | `é` `ạ` `ł` | magenta, bold | Latin letter with a diacritic or stroke, or a stray combining mark |
| Other non-ASCII | `東` `😀` | amber | No ASCII lookalike |
| Invisible | `200B` badge | red badge | Zero-width, bidi-override, format and control characters are drawn as a code-point badge |
| Unusual whitespace | NBSP, em space | red dashed box | |
| Mixed-script word | `pаypal` | red wavy underline | Letters from more than one script (Latin + Cyrillic, etc.) |

Hovering a non-ASCII character shows its code point, script and the ASCII character it imitates. Dark and Solarized Dark themes have their own colour set (`--cc-*` variables in `src/web/stylesheets/themes/`).

Only the visible part of the document is decorated (up to 100,000 characters per update), so large inputs stay responsive.

Implementation: `src/web/utils/charHighlight.mjs` (CodeMirror view plugin), toggled through a `charHighlight` compartment in `InputWaiter` / `OutputWaiter` and `OptionsWaiter.setCharHighlight()`.

## Operations

### Detect Homoglyphs

Output formats mirror *Regular expression*:

- **Highlight homoglyphs**: the input with flagged characters highlighted (same colours as the editor setting) and mixed-script words underlined. Tooltips give the offset and details.
- **List homoglyphs**: one flagged character per line.
- **List homoglyphs with details**: tab-separated `Offset, Character, Code point, Script, Type, Looks like` (chain into *To Table*).
- **List suspicious words**: each whitespace-separated word containing a flagged character or mixing scripts, next to its ASCII equivalent: `pаypal.com → paypal.com`.

Arguments choose whether accented letters, invisible characters and all other non-ASCII characters are flagged, and whether to display a total.

### Remove Homoglyphs

Converts back to plain ASCII: homoglyphs are replaced by (or removed in favour of) their ASCII lookalike, accented letters lose their accents, zero-width characters are removed and unusual spaces become normal spaces. Remaining non-ASCII characters can be kept, removed or replaced with `?`.

## Data

`src/core/lib/HomoglyphData.mjs` is generated from the Unicode confusables data (UTS #39, `confusables.txt`) plus characters whose NFKC form is ASCII. Regenerate with:

```bash
node src/core/config/scripts/generateHomoglyphData.mjs path/to/confusables.txt
```

`confusables.txt` is at https://www.unicode.org/Public/security/latest/confusables.txt; the `unicode-confusables` npm package also ships it as `data/confusables.json`, which the script accepts too. The current table was built from Unicode 10.0 data.

Confusables "skeletons" fold `I` and `1` to `l`, `0` to `O` and `m` to `rn`. The generator corrects these for readable output (uppercase lookalikes become `I`, digits become `1`/`0`). A few mappings remain close rather than exact, e.g. Arabic-Indic zero `٠` maps to `.`.

Shared logic lives in `src/core/lib/Homoglyph.mjs` (`classifyChar`, `findHomoglyphs`, `findMixedScriptWords`, `removeHomoglyphs`), so the operations and the editor setting always agree.
