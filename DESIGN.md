---
name: nahiarhdlog
description: Embedded observability dashboard drawn as a transit network map, where every event kind is a line and red means disruption.
colors:
  ground: "#ffffff"
  surface: "#ffffff"
  surface-2: "#eef1f5"
  hover: "#f2f5f9"
  select: "#e4ecfb"
  rule: "#dce1e8"
  rule-strong: "#c2c9d3"
  ink: "#0f1b2d"
  ink-2: "#364254"
  muted: "#5b6676"
  focus: "#1d5fd6"
  primary: "#14213d"
  primary-ink: "#ffffff"
  band: "#14213d"
  band-ink: "#ffffff"
  band-muted: "#b3bed3"
  band-rule: "#2a3a5e"
  band-fill: "rgba(255, 255, 255, 0.07)"
  l-request: "#1d5fd6"
  l-llm: "#7b3fd0"
  l-agent: "#5a3dc2"
  l-tool: "#d9640f"
  l-db: "#00877a"
  l-cache: "#c99a00"
  l-http: "#0a83bf"
  l-auth: "#c22e77"
  l-embedding: "#5b8812"
  l-custom: "#8a5a2b"
  l-log: "#7b8494"
  b-blue: "#78a4ff"
  b-red: "#ff7a6e"
  b-green: "#4fd690"
  b-violet: "#b896ff"
  b-amber: "#ffb547"
  b-amber-ink: "#2b1b00"
  disrupt: "#d2281f"
  disrupt-soft: "#fdecea"
  disrupt-ink: "#a51b13"
  delay: "#b46b00"
  delay-soft: "#fdf2de"
  delay-ink: "#8a5100"
  good: "#11804a"
  good-soft: "#e3f4ea"
  good-ink: "#0b6338"
  info-soft: "#e7eefc"
  info-ink: "#1a4fb4"
  critical-ink: "#ffffff"
  ground-dark: "#0f1b36"
  surface-dark: "#15264a"
  surface-2-dark: "#1c2f58"
  hover-dark: "#1a2c54"
  select-dark: "#24407a"
  rule-dark: "#263d6a"
  rule-strong-dark: "#385385"
  ink-dark: "#e8edf5"
  ink-2-dark: "#c3ccda"
  muted-dark: "#94a1b6"
  focus-dark: "#78a4ff"
  primary-dark: "#78a4ff"
  primary-ink-dark: "#0f1b36"
  band-dark: "#0a1430"
  band-muted-dark: "#a7b3cf"
  band-rule-dark: "#22355e"
  l-request-dark: "#78a4ff"
  l-llm-dark: "#b896ff"
  l-agent-dark: "#9a8cff"
  l-tool-dark: "#ff9d57"
  l-db-dark: "#3fd0bd"
  l-cache-dark: "#f1c94b"
  l-http-dark: "#55c0f0"
  l-auth-dark: "#ff7cb6"
  l-embedding-dark: "#a7cf4f"
  l-custom-dark: "#d4a272"
  l-log-dark: "#8f9aad"
  disrupt-dark: "#ff6b5e"
  disrupt-soft-dark: "#44203a"
  disrupt-ink-dark: "#ffa199"
  delay-dark: "#ffb547"
  delay-soft-dark: "#3c3324"
  delay-ink-dark: "#ffcb7d"
  good-dark: "#4fd690"
  good-soft-dark: "#163d3a"
  good-ink-dark: "#7fe3ad"
  info-soft-dark: "#213f78"
  info-ink-dark: "#9fbfff"
  critical-ink-dark: "#1d0705"
typography:
  display:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  count:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    fontFeature: "tnum"
  headline:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  wordmark:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 750
    lineHeight: 1.3
  title-sm:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 750
  tab:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14.5px"
    fontWeight: 650
  body:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  body-dense:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  button:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13.5px"
    fontWeight: 650
  label:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 650
  meta:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  column-head:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
  caption:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  chip:
    fontFamily: "Overpass, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11.5px"
    fontWeight: 750
    lineHeight: 1
  mono:
    fontFamily: "Overpass Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
  mono-path:
    fontFamily: "Overpass Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
  mono-small:
    fontFamily: "Overpass Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 600
  mono-axis:
    fontFamily: "Overpass Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "10.5px"
    fontWeight: 400
rounded:
  xs: "4px"
  chip: "5px"
  control: "7px"
  block: "8px"
  panel: "10px"
  card: "12px"
  pill: "999px"
  station: "50%"
spacing:
  tight: "4px"
  cluster: "6px"
  control-gap: "8px"
  stack: "12px"
  panel-y: "14px"
  panel-x: "16px"
  panel-x-wide: "18px"
  gutter: "24px"
  gutter-phone: "12px"
  band-gap: "28px"
  page-end: "56px"
components:
  band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.band-ink}"
    height: "56px"
    padding: "0 24px"
  tab:
    textColor: "{colors.band-muted}"
    typography: "{typography.tab}"
    padding: "2px 12px 0"
  tab-active:
    textColor: "{colors.band-ink}"
    typography: "{typography.tab}"
  band-button:
    backgroundColor: "{colors.band-fill}"
    textColor: "{colors.band-ink}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 11px"
  band-button-hover:
    backgroundColor: "rgba(255, 255, 255, 0.13)"
  status-button:
    backgroundColor: "{colors.band-fill}"
    textColor: "{colors.band-ink}"
    rounded: "{rounded.pill}"
    height: "32px"
    padding: "0 13px 0 11px"
  queued-badge:
    backgroundColor: "rgba(255, 255, 255, 0.14)"
    textColor: "{colors.band-ink}"
    typography: "{typography.mono-small}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
  dropped-badge:
    backgroundColor: "{colors.b-amber}"
    textColor: "{colors.b-amber-ink}"
    typography: "{typography.mono-small}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
  status-popover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    width: "300px"
    padding: "14px 16px"
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    height: "34px"
    padding: "0 14px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    height: "34px"
    padding: "0 14px"
  button-small:
    typography: "{typography.button}"
    height: "28px"
    padding: "0 10px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
  button-quiet-hover:
    backgroundColor: "{colors.hover}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "34px"
    padding: "0 10px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.chip}"
    rounded: "{rounded.chip}"
    height: "20px"
    padding: "1px 7px 0"
  chip-info:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info-ink}"
  chip-warning:
    backgroundColor: "{colors.delay-soft}"
    textColor: "{colors.delay-ink}"
  chip-error:
    backgroundColor: "{colors.disrupt-soft}"
    textColor: "{colors.disrupt-ink}"
  chip-critical:
    backgroundColor: "{colors.disrupt}"
    textColor: "{colors.critical-ink}"
  chip-ok:
    backgroundColor: "{colors.good-soft}"
    textColor: "{colors.good-ink}"
  filter-chip:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info-ink}"
    rounded: "{rounded.pill}"
    padding: "3px 4px 3px 10px"
  station:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.station}"
    size: "12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  log-row:
    typography: "{typography.body-dense}"
    height: "38px"
    padding: "0 12px"
  log-row-hover:
    backgroundColor: "{colors.hover}"
  log-row-selected:
    backgroundColor: "{colors.select}"
  log-row-critical:
    backgroundColor: "{colors.disrupt-soft}"
  disruption-row:
    typography: "{typography.count}"
    padding: "14px 18px"
  line-status:
    backgroundColor: "{colors.surface}"
    typography: "{typography.headline}"
    rounded: "{rounded.panel}"
    padding: "16px 18px"
  stat:
    typography: "{typography.display}"
    padding: "14px 18px"
  chart-card:
    backgroundColor: "{colors.surface}"
    typography: "{typography.title-sm}"
    rounded: "{rounded.panel}"
    padding: "14px 16px 12px"
  chart-tooltip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.block}"
    padding: "8px 10px"
  waterfall-row:
    height: "38px"
    padding: "0 16px"
  waterfall-segment:
    rounded: "{rounded.block}"
    height: "8px"
  inspector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    width: "620px"
  code-block:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.block}"
    padding: "12px 14px"
  error-card:
    backgroundColor: "{colors.disrupt-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    padding: "12px 14px"
  banner-disruption:
    backgroundColor: "{colors.disrupt-soft}"
    textColor: "{colors.disrupt-ink}"
    typography: "{typography.body-dense}"
    padding: "10px 24px"
  banner-delay:
    backgroundColor: "{colors.delay-soft}"
    textColor: "{colors.delay-ink}"
    typography: "{typography.body-dense}"
    padding: "10px 24px"
  empty-state:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    padding: "44px 16px"
  lock-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    width: "380px"
    padding: "28px 28px 24px"
---

# Design System: nahiarhdlog

## Overview

**Creative North Star: "The Runtime Transit Map"**

The dashboard reads the host app's runtime the way a rider reads a network map. Each event kind is a line with a fixed colour, every log row carries the station marker of its line, and a trace is a route drawn stop by stop from the incoming request to wherever it failed. The shell is a navy signage band; the ground is a white map in light theme and a navy night map in dark. Red appears only where service is disrupted.

Density is operational, built for someone reading next to an editor: 38px rows, 34px controls, a 14px body, and panels that sit flat on the ground behind 1px rules. Hierarchy comes from weight in Overpass, a signage sans, far more than from size; its sibling Overpass Mono carries everything a developer copies or compares. The form language is the map's own: thick round-capped strokes, ring stations, interchange dots for status, and branches that leave their parent line at 45 degrees.

Both themes are complete: every colour token has a light and a dark value, and the theme is set before first paint from the saved choice or the OS. Motion is spent once, on drawing a trace's route; everything else is short state feedback. The system rejects the category default it replaced: a grey slate dashboard of KPI cards with one neon accent.

**Key Characteristics:**
- A fixed line palette with one colour per event kind, mirrored for each theme.
- Red reserved for disruption, amber for delay, green for good service, blue washes for information.
- A 56px navy signage band whose tabs are underlined in their own line colours.
- Flat panels with 1px rules; shadows only on what floats over the map.
- Overpass for words, Overpass Mono for ids, times, paths and measurements.
- Ring stations, interchange status dots, 45-degree branches, round caps throughout.
- One authored motion: the route draws itself when a trace opens.

## Colors

A white or night-navy map ground, a navy signage band, eleven line colours that name event kinds, and a state family in which red alone means something broke. Every token is declared on `:root` and redeclared on `[data-theme="dark"]`; the inline theme script sets `data-theme` before the stylesheet paints, and each theme sets `color-scheme` so native controls follow.

### Primary
- **Signage Navy** (band and primary #14213d light; band #0a1430 dark): the shell band behind the mark, tabs and service controls, and the fill of primary buttons in light theme. In dark, primary buttons switch to Lifted Request Blue (#78a4ff) with Night Map Navy text (#0f1b36), because a navy button would vanish into the navy ground.
- **Focus Blue** (#1d5fd6 / #78a4ff): focus rings, links, trace-id buttons, the caret, text selection (mixed to 30%), checkbox accent, and the histogram hover tint (mixed to 12%).

### Secondary
The line palette. An event kind owns one colour, and its station marker, route segment, waterfall bar and stop all use it.
- **Request Blue** (#1d5fd6 / #78a4ff): requests into the app; also the Requests and p95 chart series and traceback frame lines.
- **LLM Violet** (#7b3fd0 / #b896ff): LLM spans.
- **Agent Indigo** (#5a3dc2 / #9a8cff): agent spans.
- **Tool Orange** (#d9640f / #ff9d57): tool spans.
- **Database Teal** (#00877a / #3fd0bd): db and sql spans.
- **Cache Yellow** (#c99a00 / #f1c94b): cache and redis spans.
- **HTTP Sky** (#0a83bf / #55c0f0): outbound http and service spans.
- **Auth Magenta** (#c22e77 / #ff7cb6): auth spans.
- **Embedding Olive** (#5b8812 / #a7cf4f): embedding spans.
- **Custom Brown** (#8a5a2b / #d4a272): any span kind without a line of its own.
- **Log Grey** (#7b8494 / #8f9aad): plain log events; also the histogram's base bars (at 42% opacity), the Average latency series, and the idle status dot on Metrics.

Errors have no line of their own: the error station takes Disruption Red.

**Band lines.** The ground-map line colours are too dark for the navy band, so the band uses lifted variants, identical in both themes: **Band Blue** (#78a4ff) for the Logs tab, **Band Red** (#ff7a6e) for the Errors tab and severe or unreachable status, **Band Green** (#4fd690) for the Metrics tab and good service, **Band Violet** (#b896ff) for the Trace tab, and **Band Amber** (#ffb547, with #2b1b00 ink) for minor-delay status and the dropped-events badge. The brand mark draws its two lines in Band Blue and Band Violet around a white-ringed hub filled with the band colour of the current theme (the favicon keeps Signage Navy).

### Tertiary
Service states. Each has a solid colour for strokes and fills, a soft wash, and an ink for text on that wash.
- **Disruption Red** (#d2281f / #ff6b5e; wash #fdecea / #44203a; ink #a51b13 / #ffa199): errors, 5xx codes, failed spans, CRITICAL rows, severe status, error bars in the histogram, the Errors chart series, the 3 s threshold, and the error banner.
- **Delay Amber** (#b46b00 / #ffb547; wash #fdf2de / #3c3324; ink #8a5100 / #ffcb7d): WARNING, 4xx codes, minor-delay status, warning bars, the 1 s threshold, warning stops on routes, traceback truncation markers, and the backend-switch banner.
- **Good Green** (#11804a / #4fd690; wash #e3f4ea / #163d3a; ink #0b6338 / #7fe3ad): good service, 2xx codes, OK spans, live tail running, and copy confirmation.
- **Info Blue** (wash #e7eefc / #213f78; ink #1a4fb4 / #9fbfff): INFO, 3xx codes, POST, and the filter and range chips. Info has no solid colour; it only ever appears as a wash.
- **Critical Ink** (#ffffff / #1d0705): text on the one solid state chip, CRITICAL, which fills with Disruption Red.

### Neutral
- **Map White / Night Map Navy** (ground #ffffff / #0f1b36): the page ground.
- **Panel** (surface #ffffff / #15264a): panels, the table, inspector, popover, and station centres. In light it equals the ground, so a panel is told apart by its rule; in dark it lifts one step.
- **Raised** (surface-2 #eef1f5 / #1c2f58): default chip fill, code blocks, header blocks.
- **Hover** (#f2f5f9 / #1a2c54) and **Selected** (#e4ecfb / #24407a): row and list states.
- **Hairline** (rule #dce1e8 / #263d6a): panel borders, row dividers, chart gridlines, waterfall guides.
- **Control Edge** (rule-strong #c2c9d3 / #385385): field and button borders, outlined chips, kbd hints, scrollbar thumbs, the empty-state route.
- **Ink** (#0f1b2d / #e8edf5), **Secondary Ink** (#364254 / #c3ccda), **Muted** (#5b6676 / #94a1b6): the three text tiers.
- **Band neutrals**: Band White text (#ffffff), Band Slate (#b3bed3 / #a7b3cf) for inactive tabs and the version, Band Seam (#2a3a5e / #22355e) for band button edges and the band's bottom rule, and Band Glass (white at 7%) for band button fills, rising to 13% on hover and 14% under the queued badge.

### Named Rules
**The Disruption Red Rule.** Red means something failed. No line is red, errors ride Disruption Red instead of a line, and a solid red fill appears only on failed stops, error stations, the CRITICAL chip, and status dots at severe or unreachable. A new use of red needs a failure behind it.

**The One Kind, One Line Rule.** An event kind keeps its line colour everywhere it appears: table station, route segment, waterfall bar, inspector badge. A new kind gets its own `--l-*` pair, light and dark, before it ships; it never borrows a state colour or a neighbour's line.

**The Lifted Band Rule.** On the navy band, colour comes only from the band variants (Band Blue, Red, Green, Violet, Amber) and the band neutrals, never from the ground-map line or state values.

## Typography

**Display Font:** Overpass (self-hosted variable woff2, weights 100 to 900, with system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Body Font:** Overpass
**Label/Mono Font:** Overpass Mono (self-hosted woff2, weights 300 to 700, with ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)

**Character:** Overpass descends from highway signage lettering, so the dashboard's words read like wayfinding: open, upright, heavy at the top of the ladder. Its mono sibling shares the skeleton, so an id or a duration sits on the same rhythm as the label beside it. Both faces ship inside the package under the OFL with `font-display: swap`; nothing loads from the network.

### Hierarchy
- **Display** (800, 26px, 1.15, -0.01em, tabular): stat figures in the metrics strip; the unit rides beside at 13px/600 in Muted.
- **Count** (800, 22px, tabular): signature counts in the disruption list, in Disruption Ink.
- **Headline** (800, 20px, 1.45, -0.01em): the line-status heading on Metrics and the lock screen heading.
- **Wordmark** (800, 17px, -0.01em): "nahiarhdlog", always lowercase, beside the mark.
- **Title** (750, 16px, 1.3): the inspector's event title.
- **Title Small** (750, 14px): chart captions. The same weight runs half a step up for the status popover heading (15px) and half a step down for inspector section heads (13.5px).
- **Tab** (650, 14.5px): band tabs.
- **Body** (400, 14px, 1.45): base text, fields, empty-state copy (max 46ch).
- **Body Dense** (400, 13.5px, 1.45): table cells, banners, error summaries, waterfall names.
- **Button** (650, 13.5px): buttons; small buttons drop to 12.5px.
- **Label** (650, 13px): station labels and the lock form label. Band buttons and stat keys run the same size at 600.
- **Meta** (400, 13px): meta lines ("50 events, showing 1 to 50"), the popover reason, key/value keys.
- **Column Head** (700, 12.5px): table and waterfall headers, in Muted.
- **Caption** (400, 12.5px, 1.45): legends, "Last seen", trace fact labels, tooltips.
- **Chip** (750, 11.5px, line-height 1): level, status and action chips. The text keeps the data's own case (DEBUG, INFO); nothing uses `text-transform`.
- **Mono** (400, 12.5px): times, trace ids, key/value values, tracebacks and payloads (at line-height 1.6). Inline `.mono` text runs at 0.93em of its context.
- **Mono Path** (400, 13px): request paths in rows; error signatures and the trace route id take it at 700.
- **Mono Small** (600, 11.5px): band badges, kbd hints, HTTP method and status code chips (at 700), histogram axis labels, waterfall ticks (at 500), the version (at 400).
- **Mono Axis** (400, 10.5px): chart axis and threshold labels.

### Named Rules
**The Mono Is Measurement Rule.** Overpass Mono is for what a developer copies or compares: ids, timestamps, paths, durations, methods, status codes, signatures, axis ticks, payloads. Labels, headings and sentences stay in Overpass, even inside a mono column; the waterfall's "Duration" header switches back. All table cells, stat figures, counts, trace facts and tooltip values use tabular numerals.

**The Weight Ladder Rule.** Hierarchy steps by weight (400, 500, 600, 650, 700, 750, 800) inside a narrow 10.5px to 26px band. Nothing is set larger than 26px, and tracking tightens to -0.01em only at 17px and above.

**The Optical Drop Rule.** Overpass sits high in its line box, so text beside a marker drops onto the optical centre: station labels take 2px of top padding, chips 1px, tabs 2px.

## Layout

The shell is a sticky 56px band (`--band-h`) over a single centred column (max 1600px, padding 20px top, 24px sides, 56px bottom). One view shows at a time behind the four tabs. Each view opens with a wrapping toolbar (8px gaps; the search field grows from a 300px basis with a 180px floor, 420px on Trace), then stacks flat panels 12px apart (14px after the toolbar). Inside a panel, vertical padding sits at 12 to 16px and horizontal at 16 to 18px; the lock card is the one roomier container at 28px.

Density holds at fixed heights: 38px table and waterfall rows, 34px fields and buttons, 32px band buttons, 28px small buttons, 20px chips. The table head sticks directly under the band (`top: var(--band-h)`).

Grids as built:
- **Stats strip:** five equal columns divided by 1px rules.
- **Charts:** two equal columns, 12px gap.
- **Waterfall:** route-and-name column `minmax(260px, 36%)`, an 84px duration column, and the time track taking the rest, 16px gaps.
- **Disruption row:** 76px count column, the signature, and a right-aligned "Last seen".
- **Key/value list:** 130px keys; request and response headers use 170px keys.

Responsive behaviour:
- **1200px and up:** the inspector is `clamp(440px, 40vw, 620px)` wide and `main` takes the same right margin, so the list reflows beside the open panel. Below 1200px the inspector (up to 620px) overlays the content.
- **1100px and under:** the stats strip becomes three columns; the fifth stat spans two, with a rule between rows.
- **760px and under (phone):** the band goes static and wraps, `--band-h` becomes 0, the version hides, and the status button shows its short label. Tabs move to a full-bleed, 44px, horizontally scrollable second row. Side gutters drop to 12px. In the log toolbar the search is full width, level and type selects split the row, and the range select is full width. The table scrolls horizontally, its head stops sticking, the level and trace columns hide, and the line column keeps only the station dot. Stats become two columns (an odd last stat spans both), charts one. The waterfall becomes `1fr 62px 26%` with 8px gaps: only the last tick shows, row chips and subtitles hide, names clamp to two lines at 12.5px, durations drop to 11.5px, and route lanes narrow from 14px to 10px. The inspector covers the full screen, including the band; its actions move above the title, the key hint hides, and key/value pairs stack. Disruption rows go to two columns, and the status popover pins 12px from both screen edges. The volume histogram draws 36 buckets instead of 90.

### Named Rules
**The Continuous Line Rule.** Trace rows are exactly 38px tall and each route drawing is 38px with its stop at 19px, so one row's line meets the next row's without a seam. Changing the row height breaks the route.

**The Reserved Inspector Rule.** From 1200px up, opening the inspector takes its width out of the page instead of covering the list, so the rows stay readable and walkable with J and K while an event is open.

## Elevation & Depth

The map is flat. Structure comes from 1px rules, tonal steps (in dark, panels sit one step lighter than the ground), and state washes on rows. Two shadows exist, both offset with a soft blur and both reserved for surfaces that float over the map. Stacking runs: sticky table head 2, inspector 25, band 30, status popover 40, phone inspector 45, chart tooltip 50.

### Shadow Vocabulary
- **Side panel** (`box-shadow: -14px 0 36px -14px rgba(10, 20, 44, 0.3)`; dark `rgba(0, 0, 0, 0.6)`): the inspector only, cast leftward onto the list it sits beside.
- **Pop** (`box-shadow: 0 14px 34px -10px rgba(10, 20, 44, 0.32)`; dark `rgba(0, 0, 0, 0.6)`): the status popover and the chart and histogram tooltip.

### Named Rules
**The Flat Map Rule.** Anything that belongs to the map (panels, table, lists, cards, the lock card) sits flat with a 1px Hairline border. Only what floats over the map casts a shadow, and that shadow is always offset and softly blurred.

## Shapes

Corners follow a short ladder: 4px for kbd hints, focus rings, copy buttons and the tab underline's top corners; 5px for chips; 7px for fields, buttons and band buttons; 8px for blocks inside panels (code, headers, the error card, the tooltip, the empty histogram); 10px for panels and the popover; 12px for the lock card; full pills for the status button, filter chips and band badges; circles for every station and dot.

Strokes are the map's: routes at 3px with round caps and joins; stations as 12px rings with a 3px border; tab stations as 10px rings with a 2.5px border; the brand mark at 3.4px on a 32px grid; chart series at 2.5px with round joins; thresholds at 1.5px dashed 5/4; the chart crosshair dashed 3/3; waterfall bars as 8px round-ended pills. The empty histogram uses a 1px dashed Control Edge outline. Interface icons are authored 24-grid SVGs drawn at 16px: 2px stroke, round caps and joins, no fill, `currentColor`.

### Named Rules
**The Ring and Fill Rule.** A station is a ring: line-coloured stroke around a Panel-coloured centre. A solid fill marks state: a failed station or stop fills Disruption Red, a warning stop fills Delay Amber, and the active tab fills its ring. Log events inside a route are the one exception, drawn as small solid ticks (3.5px radius) on their span's line, not as stations.

**The Interchange Rule.** Status is drawn as an interchange: a solid dot, a gap in the colour of whatever it sits on, and a ring of the same colour. The band status dot uses 10px with 2px gap and ring; the disruption count uses 12px with 2px; the Metrics line status uses 18px with 3px. Only service status and error counts use this form.

**The 45-Degree Branch Rule.** Lines change direction only at 45 degrees, with equal run and rise: in the mark, in the empty-state route, and wherever a child event branches off its parent in a trace. Nothing curves.

## Components

### Signage Band and Tabs
The shell as a transit sign: navy, white type, coloured lines.
- **Band:** 56px tall, 24px side padding, 28px gaps, Signage Navy with a 1px Band Seam bottom rule; sticky at the top (z 30). Left: the 28px mark and the wordmark, with the version in Mono Small Band Slate. Right: status, Lock, and theme toggle.
- **Tabs:** Logs (Band Blue), Errors (Band Red), Metrics (Band Green), Trace (Band Violet). Each tab leads with a 10px ring station in its line colour. Inactive text is Band Slate; hover and active turn Band White.
- **Active:** the ring fills, and a 4px underline in the line colour (inset 8px, top corners rounded 4px) grows from the left, `scaleX` 0 to 1 over 240ms on the house ease-out.
- **Band buttons:** 32px, 7px radius, Band Glass fill, 1px Band Seam border, Button text at 13px/600; the theme toggle is a 32px square icon button whose moon or sun icon tracks the theme.

### Service Status Button and Popover
The network's service board, condensed into one pill.
- **Button:** a pill band button holding an interchange status dot, the status text, and optional badges. States: Good service (Band Green), Minor delays (Band Amber), Severe delays and Backend unreachable (Band Red), No traffic and Checking service (Band Slate). On phones the text swaps for a short label (Good, Minor, Severe, No traffic, Unreachable, Checking).
- **Status rule:** derived from the last 5 minutes of requests: minor from 1% errors or p95 1 s, severe from 5% or 3 s. The same thresholds drive the Metrics line status, the stat warnings, and the latency chart's dashed lines.
- **Badges:** "N queued" in Mono Small on white at 14%; "N dropped" in Mono Small on Band Amber with its dark ink. Both are pills, shown only when the count is above zero.
- **Popover:** 300px, Panel fill, 1px Hairline, 10px radius, Pop shadow, 8px below the button. A 15px/750 heading, the reason and rule in 13px Muted, then a two-column definition list (queued, dropped, backend, storage, text search, retention, version) with values right-aligned in Mono.

### Buttons
Compact and squared-off, like control-panel keys.
- **Shape:** gently rounded (7px), 34px tall, 14px side padding, 7px icon gap.
- **Default:** Panel fill, Ink text, 1px Control Edge border. Hover takes the Hover fill and a Muted border.
- **Primary:** Signage Navy fill and border with white text in light; Lifted Request Blue with Night Map Navy text in dark. Hover brightens by 12%. One per toolbar: Search, Show trace, Unlock.
- **Quiet:** no border or fill until hover (Clear filters, Recent traces, the inspector close).
- **Small:** 28px tall, 10px padding, 12.5px text; used in the inspector and trace head.
- **Disabled:** default buttons drop to 45% opacity on a Panel fill (the pager's Newer and Older at either end). Primary buttons keep their Signage Navy (dark: Band Blue) fill and ink at 60% opacity while their action is in flight, as the lock screen's "Unlocking" state shows. **Copied:** the label swaps to a check icon and "Copied" in Good Ink with a Good border and Good wash for 1.4 s; the row's copy icon turns Good Green for 1.2 s.

### Inputs / Fields
- **Style:** 34px, 10px padding, 1px Control Edge border, 7px radius, Panel fill, Body text; placeholders in Muted at full opacity. Hover darkens the border to Muted. Selects keep native arrows with 28px right padding.
- **Search:** a 16px magnifier icon inset at 11px and 34px left padding; a `/` kbd hint sits at the right and hides while the field has focus or a value.
- **Focus:** the global ring (2px Focus Blue, 2px offset).
- **Live tail toggle:** a 16px native checkbox in Focus Blue accent, an 8px dot, and the label at 13.5px/600. When on, the label turns Good Ink and the dot fills Good Green and pulses (opacity to 35% and back over 1.6 s).
- **Lock field:** 40px tall at 15px, full card width.

### Chips
Small rectangles of data, 20px tall, 5px radius, 1px top padding, Chip type.
- **Levels:** DEBUG outlined (inset 1px Control Edge, Muted text); INFO Info wash; WARNING Delay wash; ERROR Disruption wash; CRITICAL solid Disruption Red with Critical Ink.
- **Status codes** (Mono Small at 700): 2xx Good wash, 3xx Info wash, 4xx Delay wash, 5xx Disruption wash.
- **Methods** (Mono Small at 700, minimum 3.9em, centred): GET outlined; POST Info wash; PUT and PATCH Delay wash; DELETE Disruption wash. Mutating rows (DELETE, PUT, PATCH) set the method chip at 800.
- **Actions and entities in log messages:** Created Good wash, Updated or Renamed Delay wash, Deleted Disruption wash; entity names outlined in Hairline at 600; model names outlined in Control Edge, in Mono at 600.
- **Known divergence:** the DELETE method chip and the Deleted action chip borrow the Disruption wash although nothing failed. This breaks the Disruption Red Rule in the current build and is not a precedent for new chips.
- **Filter and range chips:** pills in Info wash with a round remove button around a 16px icon (current-colour tint at 15% on hover), sitting 10px under the toolbar.

### Station Markers
The line identity of every event. A 12px ring with a 3px border in the event's line colour around a Panel centre, then the kind name at 13px/650 in Secondary Ink with the Optical Drop. Error events and failed spans fill the ring solid Disruption Red. Used in the table's Line column, inspector badges, and recent-trace rows.

### Log Table
The main departure board.
- **Container:** Panel fill, 1px Hairline, 10px radius; head cells Column Head on Panel with a Hairline rule, sticky under the band.
- **Rows:** 38px, 12px cell padding, Hairline dividers, Body Dense. Columns: Time (Mono 12.5px Muted, full timestamp on hover), Line (station), Level (chip), Message (truncates with an ellipsis), Trace (an 8-character Mono id in Focus Blue that opens the trace, with a copy icon revealed on row hover).
- **Message anatomy:** requests show method chip, Mono path, status chip and a Mono Muted duration; spans show a 650 name with Muted model, duration and tokens; errors show the exception type at 750 in Disruption Ink, then the message.
- **States:** hover takes the Hover fill; selected takes Selected; CRITICAL, error events and 5xx rows take the Disruption wash (mixed 55% with Selected when selected); ERROR and 4xx rows set the name and message in Disruption Ink; WARNING rows set the message in Delay Ink. Focused rows show a 2px Focus Blue ring inset by 2px.
- **Pager:** default buttons with chevrons ("Newer", "Older") around a Meta page count.

### Volume Histogram
The line's traffic over time, sitting between the toolbar and the table.
- **Bars:** a 64px strip of bars, 90 buckets (36 on phones), 2px gaps once bars are wider than 6px, 1px corner radius. Each bar stacks Log Grey at 42% opacity, then Delay Amber for warnings, then Disruption Red for errors at the base.
- **Interaction:** hovering a bucket tints it Focus Blue at 12% and shows the tooltip (time span, events, errors, warnings). Clicking narrows the log range to that bucket, pauses live tail, and adds a removable range chip.
- **Axis:** three Mono Small Muted labels (start, middle, end).
- **Empty:** "No events in this range", centred in a 64px box with a 1px dashed Control Edge outline and 8px radius.

### Inspector
A non-modal side panel, so the list stays in view.
- **Panel:** fixed below the band on the right, Panel fill, 1px Hairline left border, Side panel shadow. Closed, it sits translated 104% off screen and hidden; open, it slides in over 260ms on the house ease-out.
- **Head:** a badge row (station, status chip, model chip), the Title (16px/750, wrapping anywhere), and small buttons: Copy JSON, Copy as cURL (requests only, secrets stay redacted), View trace, and a quiet close icon.
- **Body:** an error card when relevant (Disruption wash, 1px border of Disruption Red at 35%, 8px radius; the exception type in Mono 14px/700 Disruption Ink, the message 14px/600 Ink), then a 130px key/value grid (Muted keys, Mono values; plain-text values switch back to Overpass), then sections with 13.5px/750 heads and small copy buttons.
- **Blocks:** headers as a Mono 12px grid on Raised; payloads and tracebacks as Raised `pre` blocks with a Hairline border, 8px radius, Mono 12.5px at 1.6, capped at 340px and 460px. Traceback frames are Request Blue at 600, the exception line Disruption Ink at 700 on its wash, local variables Muted, truncation notes a centred Delay band.
- **Footer hint:** "J and K move between events. Esc closes this panel." in 12px Muted with kbd keys.

### Disruption List
Errors grouped by signature, read as service disruptions.
- **Container:** a Panel list with 1px Hairline dividers and 10px radius.
- **Row:** a full-width button, 14px by 18px padding. The count sits in Count type (22px/800 Disruption Ink) after a 12px red interchange dot; the signature is Mono 13px/700; "Last seen" is a right-aligned Caption; the summary runs below in Body Dense Secondary Ink, truncated. Hover takes the Hover fill; clicking opens Logs filtered to that signature.
- **Meta line:** "N errors in M signatures, most frequent first." with the total in bold Ink.

### Metrics: Line Status and Stats Strip
- **Line status:** a Panel strip (16px by 18px) with an 18px interchange dot in the status colour (Good Green, Delay Amber, Disruption Red, or Log Grey when idle), a Headline title (Good service, Minor delays, Severe delays, No traffic), and the reason plus the status rule in 13.5px Muted.
- **Stats strip:** one Panel divided into five cells by 1px Hairlines: Requests, Throughput (req/s, or req/min under 1 per second), Error rate, Latency p50, Latency p95. Keys at 13px/600 Muted, figures in Display, units at 13px/600 Muted. Error rate and p95 turn Delay Ink at the minor threshold and Disruption Ink at severe. Missing values show an en dash.

### Line Charts
Plain line charts that borrow line meaning.
- **Card:** a `figure` panel (14px 16px 12px) with a Title Small caption.
- **Plot:** sized from its container, 200px tall (190px under 480px wide). Four Hairline gridlines on a 1/2/2.5/5 step scale, Mono Axis labels, three time labels. Series at 2.5px with round joins; the primary series gets a 9% area fill. A bucket with no samples breaks the line rather than dropping to zero, and an isolated point draws as a 3.5px station ring.
- **Series:** Requests and errors uses Request Blue for Requests and Disruption Red for Errors (5xx). Latency uses Request Blue for p95 and Log Grey for Average, with dashed threshold lines in Delay Amber (1 s) and Disruption Red (3 s) labelled in Mono Axis.
- **Legend:** 16px by 4px round swatches in Caption Muted; the threshold key is a dashed swatch shown only when a threshold line is actually drawn, otherwise a note says which thresholds sit above the range. The legend hides when there is no data.
- **Hover:** a dashed Muted crosshair and the tooltip (Panel, Hairline, 8px radius, Pop shadow, Mono time, tabular values at 750).
- **Empty:** "No requests in this window yet." centred in 13.5px Muted.

### Trace: Route Diagram and Waterfall
The signature component: a request's journey drawn as a route.
- **Trace head:** a Panel (12px by 16px) with the route id in Mono 13px/700, facts as Caption labels with 14px/750 tabular values (Duration, Events, Spans, Tokens, Tool calls, Errors in Disruption Ink), model chips, and a small Copy trace id button.
- **Waterfall:** a Panel with a 34px header (Route, Duration, and Mono Small ticks at 0, 25, 50, 75 and 100% of the span), then 38px rows. Hover takes the Hover fill, selected takes Selected, failed rows take the Disruption wash mixed 70% into Panel.
- **Route column:** each depth is a 14px lane (10px on phones, up to 10 levels). A parent's line runs straight down while it still has stops below; a child branches off at 45 degrees into its own line colour; stops sit at the row's mid-height. Requests, spans and errors are 5px-radius ring stops; failures fill red; logs are small solid ticks in their span's colour, or larger amber and red ticks for warnings and errors.
- **Track:** Hairline guides at 0, 50 and 100%. Events with a duration draw an 8px round-ended bar in their line colour; point events draw a 12px ring mark (filled red on failure, amber for warnings). Durations sit in their own Mono column; point events show their start offset ("+60.1 ms") in Muted.
- **Motion: the route draw.** When a trace opens, each row's route strokes draw from start to end over 520ms on the house ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`), staggered 32ms per row and capped at 30 rows. Stops fade in over 260ms starting 180ms after their row, and waterfall bars grow from the left over 520ms starting 120ms after. This is the system's one orchestrated moment.
- **Recent traces:** a Panel list of buttons (12px by 16px): method chip, Mono path, status chip and duration on top with a right-aligned relative time; below, the Mono trace id, event count, and "Has errors" in Disruption Ink at 650.

### Banner
A full-width strip under the band: 10px by 24px, Body Dense, with a dismiss icon at 80% opacity. Errors use the Disruption wash and ink with a bottom rule of Disruption Red at 30%; the backend-switch warning uses the Delay wash and ink with a matching Delay rule.

### Empty States
Honest and short. A 120px by 28px drawing of an empty route (two Control Edge stations joined by a 3px line with one 45-degree bend), a 15px Ink title, and one Muted sentence (max 46ch), centred with 44px by 16px padding. Loading states are a plain Meta line ("Loading errors", "Loading trace").

### Lock Screen
The same band, mark and wordmark without tabs (static, not sticky), over a centred card: 380px max, 28px padding (24px bottom), 12px radius, Panel fill, 1px Hairline, no shadow. A Headline ("This dashboard is locked"), a 14px Muted explanation, a 13px/650 label, a 40px password field, and a full-width 40px primary Unlock button. Errors appear above the label in 13.5px/650 Disruption Ink, announced as an alert, and name the recovery.

### Focus, Keyboard and Assistive Conventions
- **Focus ring:** every focusable element shows a 2px Focus Blue outline at 2px offset with 4px radius. Table rows, waterfall rows and list rows inset it by 2px with square corners; tabs inset it by 4px. Tab panels take focus without a ring.
- **Browser surfaces:** text selection is Focus Blue at 30%, the caret is Focus Blue, links underline at a 3px offset, scrollbars are thin with Control Edge thumbs (10px, rounded, 2px transparent inset), and native controls follow the theme's `color-scheme`.
- **Tabs:** a real tablist with roving tabindex and `aria-selected`; Left and Right arrows, Home and End move between tabs.
- **Keys:** `/` focuses search from any view; J and K walk the visible rows (and follow in the inspector when it is open); Enter or Space opens a row; Esc closes the status popover first, then the inspector, returning focus to where it came from.
- **Names:** the status button's accessible name states the status plus any queued or dropped counts; the theme toggle names the theme it switches to; icon-only buttons carry labels; selects carry `aria-label`; search labels are visually hidden, not missing.
- **Graphics:** decorative SVGs (icons, routes, dots) are `aria-hidden`; the histogram and charts are `role="img"` with a sentence summarising the data; waterfall rows are buttons whose names give the event, duration and start offset. The inspector toggles `aria-hidden` and leaves the tab order when closed.
- **Announcements:** the banner and lock errors use `role="alert"`.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, every animation and transition is removed and the route, stops and bars render in their final drawn state; the inspector and tab underline change instantly and the live dot stops pulsing.

## Do's and Don'ts

### Do:
- **Do** take every colour from a custom property declared on both `:root` and `[data-theme="dark"]`; both themes ship finished.
- **Do** give a new event kind its own `--l-*` line pair and show it as a ring station with a text label.
- **Do** pair a state's wash with its ink (Disruption, Delay, Good, Info) for chips, banners and rows, and keep solid Disruption Red for failed stops, error stations and CRITICAL.
- **Do** keep map panels flat: Panel fill, 1px Hairline border, 10px radius, 12 to 16px vertical and 16 to 18px horizontal padding, stacked 12px apart.
- **Do** carry state in words as well as colour: the status dot travels with its status text, level chips spell the level, failed traces say "Has errors".
- **Do** state empty and degraded conditions plainly: the empty-route drawing, a 15px Ink title, one Muted sentence; queued and dropped counts in the band whenever they are above zero.
- **Do** keep the route draw as the only entrance animation, on `cubic-bezier(0.16, 1, 0.3, 1)`, and make every motion resolve to its final state under reduced motion.
- **Do** draw icons as 24-grid stroke SVGs at 16px: 2px stroke, round caps and joins, `currentColor`, no fill.

### Don't:
- **Don't** use red, or any colour from the Disruption family, for anything that did not fail.
- **Don't** put ground-map line or state colours on the navy band; use the band variants.
- **Don't** shadow a panel that sits on the map, and never use a shadow without blur.
- **Don't** split the metrics into separate KPI cards; the five figures share one ruled strip.
- **Don't** set labels or sentences in Overpass Mono, and don't set type larger than 26px.
- **Don't** curve a route or a branch; lines turn at 45 degrees.
- **Don't** change trace row height from 38px without redrawing the route geometry to match.
- **Don't** load fonts, icons or scripts from the network; Overpass and Overpass Mono ship as local woff2 files.
- **Don't** add hard-coded colours; the band amber, its ink, the band hover and badge whites, and the CRITICAL chip ink are existing literals, not a pattern to copy.
