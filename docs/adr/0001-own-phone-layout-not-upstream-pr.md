---
status: accepted
---

# Build our own phone layout instead of porting upstream's responsive UI PR

CyberChefCloud needs to be usable on a phone, for building recipes as well as running saved ones. Upstream CyberChef has an open responsive-UI pull request (gchq/CyberChef#2187, continuing #1615). We decided not to port it. Instead we add a separate **phone layout** (run screen, recipe strip, argument sheet, recipe editor, operation picker) as a new module under `src/web/mobile/`, with CSS scoped to `body.mobile`. The phone layout reuses the desktop's existing recipe elements (`#rec-list` and the argument forms built by `HTMLOperation` / `HTMLIngredient`) rather than building new ones.

## Considered options

- **Port PR #2187.** It is unmerged and targets upstream v12. It is built on upstream v11 (Node 24) while this fork is on v10.22.1 (Node 18). It replaces `HTMLOperation` with new web components and rewrites `RecipeWaiter`, `OperationsWaiter` and every stylesheet. Those are the files this fork has changed most: sensitive arguments, password-manager credential icons, `populateAppendOption`, `acceptsOperations`, and the homoglyph theme colours. The PR's layout also stacks three panes in about 700px, uses double-tap to add and long-press to reorder, and has no single-tap alternative to dragging (WCAG 2.2 SC 2.5.7).
- **Bottom tab bar (as in the unofficial cyberchef-android port).** This was the cheapest option, but you cannot see the output while you edit an argument, which loses CyberChef's live feedback.
- **Notebook of steps showing the output under each step.** This needs changes to the chef and the worker, and would call cloud APIs again for every step.
- **Build new mobile argument forms.** These would duplicate all the argument-form logic, and every argument feature added to the desktop would also need adding to the mobile forms.

## Consequences

- The fork stays separate from upstream's UI work. We take upstream security fixes, and they still merge cleanly because the desktop code is unchanged. If #2187 is ever merged upstream, it is not expected to come into this fork.
- Any change to the desktop recipe elements also changes the phone layout. Test both layouts after changing them.
- The phone layout is chosen by the screen size: under 768px wide, or a touch screen under 500px tall. An Options setting can force the phone or desktop layout. Tablets use the desktop layout.
