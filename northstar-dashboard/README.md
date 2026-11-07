# Northstar — Product Analytics Dashboard

A high-fidelity, enterprise-grade **product analytics dashboard** prototype built as a zero-dependency front-end project. It demonstrates a complete analytics workbench — overview metrics, charts, cohort and user views, a command palette, modal workflows, toasts, and an authentication screen — all rendered with hand-built SVG and vanilla JavaScript. No frameworks, no build step, no third-party runtimes.

> **Note:** This is a front-end prototype for demonstration purposes. All data shown is mock/demo data generated client-side. Wiring it to a real analytics API, auth provider, and persistence layer is the next phase (see *Next Steps*).

---

## Features

- **Design-system driven UI** — a single source of truth for color, typography, spacing and elevation via CSS custom properties (design tokens).
- **Multi-view application shell** — collapsible sidebar navigation, sticky top bar, and a client-side router that swaps views without a full page reload.
- **Hand-built SVG charts** — line, bar, area and donut visualizations rendered from data, with no charting library.
- **Virtualized list rendering** — long tables/feeds render only the visible window for smooth scrolling at scale.
- **Command palette (⌘K / Ctrl-K)** — keyboard-first navigation and actions across the whole app.
- **Modal & overlay system** — reusable modal layer for detail panels, forms and confirmations.
- **Toast notifications** — non-blocking, auto-dismissing feedback on user actions.
- **Authentication screen** — a polished login / entry view with demo credentials.
- **Dark, production-grade aesthetic** — deep navy surfaces, subtle elevation, and a restrained accent palette.
- **Responsive layout** — adapts from desktop workspace to narrower viewports with a collapsing sidebar.

---

## Tech Stack

| Layer       | Technology                                          |
|-------------|-----------------------------------------------------|
| Markup      | Semantic **HTML5**                                  |
| Styling     | **CSS3** — custom properties, grid, flexbox, SVG     |
| Logic       | **Vanilla JavaScript (ES2015+)** — no frameworks    |
| Icons       | Inline **SVG sprite** (zero icon-font dependency)    |
| Data        | Client-side mock data + adapter layer (demo mode)    |
| Tooling     | None — runs directly in the browser                  |

There is **no bundler, no npm install, and no external CDN**. The entire experience is self-contained in three files plus local image assets.

---

## Getting Started (Local)

Because the project is plain static files, any static server works. The simplest option:

```bash
# From the project root (the folder containing index.html)
python3 -m http.server 8080
```

Then open your browser at:

```
http://localhost:8080
```

> Serving over `http://` (rather than opening the file with `file://`) is recommended so that `fetch`-based data adapters and module loading behave consistently. Any equivalent static server (e.g. `npx serve`, `php -S`) works equally well.

To deploy, upload the **entire folder** (including `styles.css`, `app.js` and `images/`) to any static host such as Netlify Drop, Vercel, GitHub Pages, or an S3 bucket.

---

## Project Structure

```
northstar-dashboard/
├── index.html        # Clean HTML skeleton: structure, SVG sprite, mount points
├── styles.css        # Full design system: tokens, layout, components, themes
├── app.js            # All application logic: router, views, charts, state, UI
├── README.md         # This document
└── images/           # Local photography & avatars (logo, team, user avatars)
    ├── team-table.jpg
    ├── avatar-dana.jpg
    ├── avatar-marcus.jpg
    └── ... (12 assets in total)
```

- **`index.html`** defines the document structure only — the SVG icon sprite, the application root containers (`#app`, `#view`, `#overlay`, `#cmd`, `#toasts`) — and pulls in `styles.css` and `app.js`. No styling or logic lives inline.
- **`styles.css`** contains the complete design system: design tokens (`:root` custom properties), base resets, layout primitives, and every component style.
- **`app.js`** contains all behavior: the infra/runtime layer (DOM helpers, router, toast, modal) and the feature logic (data generation, view rendering, charts, command palette, authentication). It loads with `defer`, so the DOM is ready before execution.

---

## Architecture Notes

- **Runtime layer (`NS`):** a small in-file namespace provides DOM helpers (`$` / `$$`), a hash-based **router**, a **toast** controller, and a **modal** controller. Views register themselves with the router and render into `#view`.
- **Data adapter:** a demo data source generates deterministic mock analytics (metrics, time series, cohorts, user records). Swapping in a real REST/GraphQL backend is a single-point change in the adapter — the view layer does not change.
- **Rendering:** views are rendered as strings/templates and mounted into the DOM; long lists use windowed (virtual) rendering to stay performant.
- **No global leakage surprises:** logic runs as a single classic script; identifiers are namespaced under `NS` to avoid collisions.

---

## Browser Support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari) supporting ES2015+, CSS Grid, and CSS custom properties. No polyfills required.

---

## Next Steps

The front-end is complete and production-shaped. Recommended follow-ups before a live launch:

1. **Connect a real data API** — replace the demo adapter with the production analytics endpoint(s).
2. **Authentication** — wire the login screen to a real identity provider (OAuth / SSO) and session handling.
3. **Authorization & roles** — scope views and actions by user role.
4. **Real chart data pipeline** — stream live metrics and add caching / incremental updates.
5. **Analytics & monitoring** — add product telemetry and error reporting.
6. **Content & legal** — supply real copy, privacy policy, and terms (currently placeholder/demo).

---

© Demo project. All names, metrics, and imagery are fictional and for presentation only.
