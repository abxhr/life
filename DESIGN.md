# Life — design spec ("the day, quietly", as a notebook)

**Concept.** Wealth is a printed ledger; Life is the personal notebook next to it. Cream ruled paper, a red margin line, a spiral-bound navy cover for navigation, sticky notes and washi tape only for hero moments. One memorable element per screen. No glass, glow, gradients, stock art, or emoji-as-icons.

## Tokens (`static/css/app.css`, defined once)
| | Light "paper" | Dark "night" |
|---|---|---|
| paper / panel | `#f3edda` / `#fbf7ea` | `#1b1e19` / `#232720` |
| ink / ink-2 / ink-3 | `#1d2233` / `#4b5062` / `#6a6d78` | `#ece6d2` / `#bdb8a6` / `#9a9686` |
| pen (accent, primary actions, active nav) | `#2c3fd8` | `#93a0ff` |
| margin (red pen: now-line, FAB, badges) | `#d4574c` | `#e0695e` |
| good / bad / warn | `#0e7c5a` / `#b8322b` / `#a65f0a` | `#4fd1a0` / `#ff8077` / `#e8a94a` |
| domain markers (tiny only) | travel teal `#0f7e85`, health coral `#c2483a`, work slate `#4a5a6b`, goals ochre `#a8700f`, notes violet, lists green | lighter variants |

Radii: controls 7, panels 4 (paper corners), dialogs 14. Spacing: 4px grid. Ruled-line pitch `--lh` 32px (28 compact) — body text sits on the lines.

## Type
- **Caveat 700** — titles, hero sentence, card headings, numbers that should feel hand-written.
- **Patrick Hand** — body, labels, everything you read (min 18px body, 19px on mobile).
- **Nunito** — only tiny axis/time labels (<14px) where a handwriting face would blur.
Fonts are self-hosted (`static/fonts`): no request ever leaves for Google.

## Components
Hand-drawn borders (asymmetric radius) on buttons and chips; underline-only inputs; ruled textareas; SVG-style checkbox with a drawn tick and an animated strike-through; cards = paper with a hairline; **sticky** = "the one thing" / quick hero; **taped** = shell for focus moments; spiral-ring spine; dialogs are bottom sheets on mobile. Gallery: `/_styleguide`.

## Rules
Accent only for primary action, active nav, the "you" series in charts. Sentence-case copy, short and human ("3 things left"). Never shame: overdue = "a few slipped", with move/park/drop. Motion only in response to actions (tick draw, strike, toast) plus one reveal on load; `prefers-reduced-motion` removes it. Contrast AA in both themes. Touch targets ≥44px, hover is never the only affordance. Charts: one accent series, direct labels, sparklines, no pies except ≤4 parts.
