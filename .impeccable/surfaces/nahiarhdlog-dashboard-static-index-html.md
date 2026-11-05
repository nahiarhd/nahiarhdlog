---
version: 1
slug: "nahiarhdlog-dashboard-static-index-html"
primary_target: "nahiarhdLOG/dashboard/static/index.html"
related_targets: ["nahiarhdLOG/dashboard/static/app.js","nahiarhdLOG/dashboard/static/styles.css","nahiarhdLOG/dashboard/static/lock.html"]
---

# Dashboard surface

Scope: the embedded dashboard (index, lock screen) served at the host app's prefix. Visitor mode: Operate.

Audience and job: mixed developers (see PRODUCT.md). All four jobs are frequent and equal: live tail, error investigation, AI/span trace reading, post-deploy health. The user asked for more capability where it serves those jobs.

Constraints: name "nahiarhdlog" is fixed; mark may be redesigned. Theme follows the OS, both themes finished, manual toggle. Self-contained static files, no runtime network. Standard web controls only.

Additions for this round: service status in the header (derived from the last 5 minutes of requests), event-volume histogram over the log table that narrows the time range on click, a non-modal inspector panel with j/k row navigation, copy-as-cURL for requests.

Unresolved: none.

## Direction contract

THESIS: The app's runtime read as a transit network: every event kind is a line with its own colour, a trace is a route drawn station by station. Refuses the category default of a grey slate dashboard with KPI cards and one neon accent.

OWN-WORLD: White network-map ground (night-map navy in dark), a navy signage band for the shell, a fixed line palette (request blue, LLM violet, tool orange, db teal, cache yellow, http sky, auth magenta, embedding olive, custom brown, log grey) with red reserved for disruption. Overpass signage sans, Overpass Mono for ids and time. Thick round-capped strokes, station dots with white rings, 45-degree branches.

STORY: The visitor sees service status at once, scans events by line colour, opens any one into the inspector, and follows a trace as a route from request to the failing station.

FIRST VIEWPORT: Navy band: mark and name left, four tabs each underlined in its own line colour, service status, queue, lock and theme right. Below: filter bar, volume histogram, then the log table filling the viewport; inspector slides in from the right.

FORM: Transit network diagram, position 3 of 7 on the ordered list. seed:34fb247c6751c11b

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
