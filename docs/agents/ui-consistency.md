# UI consistency

A new or changed control looks like a sibling of the controls around it. Its
**neighbours** are the established controls with the same role in the same pane,
such as the scanner choices, the actions beside a card or a modal's actions.
Match them in size, height, width, radius, type, colour tokens and spacing.

## Build from the shared rules

- Use the existing classes and tokens: `.btn` with its colour variant,
  `.btn.sm` for actions beside a card, `.iconbtn`, `.chip`, and the colour
  variables (`--yes`, `--no`, `--cant`, `--danger`, `--line`, `--surface` and
  the rest) in `index.html`'s stylesheet. Read the current values there.
- Put a sizing or spacing decision in the shared rule, so every current and
  future control inherits it. `.btn`'s `min-inline-size` is the model (#2449).
  Yes, No and Can't shrank to their labels under far wider side-rail buttons of
  the same colours, because each control had been sized on its own.
- Give a genuinely new kind of control a named class with a comment on why it
  differs, and size it in em so enlarged text scales it with its neighbours.
- Keep the 44px tap height wherever a control's neighbours have it.

## Check against the neighbours

A control is consistent when it is no smaller than its neighbours at the same
size and its row keeps the layout it had: the same line breaks, no clipping
and no sideways overflow at 320 px, 390 px, tablet and desktop widths, with
enlarged text and with web fonts both loaded and blocked. Fonts change widths,
so a check that only runs with fonts blocked can pass a row that wraps for a
person.

Prove it with a rendered test that measures the control and its neighbours,
including one that adds a new control with the standard classes. Capture the
evidence as [visual test requirements](rendered-evidence.md#visual-test-requirements)
describes.
