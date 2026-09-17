# PressPixel Design Contrast Report

WCAG 2.1 thresholds:

- AA normal text: 4.5:1 or higher
- AA large text: 3:1 or higher
- AAA normal text: 7:1 or higher
- AAA large text: 4.5:1 or higher

| Foreground | Background | Ratio | AA normal | AA large | AAA normal | AAA large |
|---|---|---:|---|---|---|---|
| `#F2F2EB` primary text | `#0B0B0B` background | 17.5:1 | Pass | Pass | Pass | Pass |
| `#A5A59B` muted text | `#0B0B0B` background | 7.92:1 | Pass | Pass | Pass | Pass |
| `#85857B` subtle text | `#0B0B0B` background | 5.28:1 | Pass | Pass | Fail | Pass |
| `#6F6F67` faint text | `#0B0B0B` background | 3.89:1 | **Fail** | Pass | Fail | Fail |
| `#FFA500` orange accent | `#0B0B0B` background | 9.97:1 | Pass | Pass | Pass | Pass |
| `#1B1200` CTA text | `#FFA500` primary CTA | 9.38:1 | Pass | Pass | Pass | Pass |
| `#171713` primary dark text | `#EEEEE5` light surface | 15.4:1 | Pass | Pass | Pass | Pass |
| `#5C5C55` muted dark text | `#EEEEE5` light surface | 5.77:1 | Pass | Pass | Fail | Pass |

## Finding

The core palette has excellent contrast. The exception is `#6F6F67` on the main dark background, which fails AA for normal-sized text. Keep it decorative, use it only for sufficiently large text, or brighten it when the content is required to understand or complete a task.
