# UI consistency

Design guidance for new and changed controls. It adds no test or review gate:
evidence stays with [visual test requirements](rendered-evidence.md#visual-test-requirements)
and [TDD and regression gates](tdd-and-regression.md).

A new control looks like a sibling of its **neighbors**: the established
controls with the same role in the same pane, such as the scanner choices, the
actions beside a card or a modal's actions. It matches them in height, width,
radius, type, color tokens and spacing, and its row keeps the line breaks it
had.

## Build from the shared rules

- Start from the existing classes and color variables in `index.html`'s
  stylesheet: `.btn` with a color variant, `.btn.sm` beside a card, `.iconbtn`,
  `.chip`.
- Put a sizing or spacing decision in the shared rule, so current and future
  controls inherit it. `.btn`'s minimum width is the model (#2449). Yes, No
  and Can't had shrunk to their labels under far wider side-rail buttons of
  the same colors, because each control had been sized on its own.
- Build neighbors from one renderer where they share a role. The actions under
  the dotted task and under the candidate are one family, built by
  `boardPresentation.cardActions` with one style (#2460).
- Give a genuinely new kind of control a named class with a comment on why it
  differs from its neighbors.
- Size in em, so enlarged text scales a control with its neighbors.
- Style the scanner by class, never by a `data-*` attribute: the saved view
  shown before the app loads keeps classes but drops data attributes, so a
  data-attribute layout rule lays the scanner out differently before and after
  loading (117 px in #2460). A core test fails on such a rule (#2480).
- Judge widths with the web fonts loaded as well as blocked. The fonts change
  label widths, so a row that fits on fallback fonts can wrap for a person.
