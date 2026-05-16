# remon-web

Web UI for Remon — a self-hosted system monitoring platform. Connects to one or more [remon-server](../remon-server) instances and provides a real-time dashboard, metrics history, alerts, and terminal access.

> Early development. API may change between versions.

## Features

- **Overview dashboard** — live CPU, memory, disk I/O, network via SSE; per-core heat grid, pressure pills (PSI), swap
- **Metrics history** — time-series charts with configurable range (15m–7d), time travel, auto-refresh; batch endpoint keeps round-trips minimal
- **Processes** — flat and tree view, sort, filter, kill via modal
- **Services** — systemd / OpenRC / SCM; timers, cron, live log streaming
- **Docker / Podman** — container lifecycle, stats panel, exec terminal over WebSocket
- **Alerts** — rule management (builder / template / raw modes), active state, event history, silence presets
- **Notification channels** — Telegram, ntfy, webhook, FCM, Web Push; test-send
- **Custom probes** — run history, metric charts, manifest viewer
- **Multi-server** — pair unlimited servers; per-server accent color, independent SSE streams
- **Vault** — all credentials encrypted at rest (AES-256-GCM, PBKDF2-SHA256 600k iterations); unlock on every session
- **PWA** — installable, service worker, offline shell
- **i18n** — English and Turkish (paraglide-js)

## Requirements

[remon-server](../remon-server) running and reachable from the browser.

Node.js is only needed for type-checking. The runtime and package manager is [Bun](https://bun.sh).

## Quickstart

```sh
# Install dependencies
bun install

# Start dev server (hot reload)
bun dev

# Type-check
bun run check

# Production build (static SPA → build/)
bun run build
```

## Pairing a server

1. Open the app and complete vault setup (first run only)
2. Go to **Servers → Add server**
3. Enter the server URL and a display name
4. The server prints an 8-digit pairing code — enter it in the UI
5. Done — the server appears in the dashboard

## Deployment

The build output (`build/`) is a static SPA. Serve it from any static host or CDN:

```sh
# Example: serve locally
bunx serve build/

# Example: copy to nginx root
cp -r build/ /var/www/remon/
```

The app connects directly from the browser to each remon-server instance, so CORS must be configured on the server side for the origin you serve the UI from:

```toml
# remon-server config/production.toml
[cors]
allow_any_origin = false
allowed_origins = ["https://your-remon-ui.com"]
```

## Tech stack

- [SvelteKit 5](https://svelte.dev) (runes mode, static adapter)
- [Tailwind CSS v4](https://tailwindcss.com)
- [ECharts](https://echarts.apache.org) (lazy-loaded, ~500 KB gzipped)
- [xterm.js](https://xtermjs.org) (Docker exec terminal)
- [paraglide-js](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) (i18n)
- [Bun](https://bun.sh) (runtime + package manager)
