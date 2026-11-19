# remon-web

The browser client for [remon-server](https://github.com/adnanjpg/remon-server).

There is no backend here. It is a static app that talks to each server you pair
straight from the browser, and keeps their credentials in an encrypted vault in
that browser.

Pre-1.0. It moves in step with remon-server, and the API between them can break
from one version to the next.

## What it does

**Watch a host.** Live vitals over SSE. Metric history with min/max bands and
the host's usual range behind it. Processes, services (systemd, OpenRC, Windows
SCM), Docker and Podman containers. One timeline for boots, alerts, incidents
and who did what from which device.

**Hear about it.** Alert rules, including windowed ones like
`max(cpu.usage_percent, 30s) > 80`, with silences. Heartbeats for cron jobs and
outside services that should check in. Incidents that keep a frame of the host
at each moment worth looking at later. Notifications to Telegram, ntfy,
webhooks, FCM and Web Push.

**Act on it.** Restart a service, kill a process, open a shell in a container.
Bind an action to a rule and choose whether it waits for you to confirm, runs
as a dry run, or runs on its own within limits.

**Ask about it.** The assistant answers questions about a host in plain
language. The server reads its own metrics, logs and processes to answer, and
can draw the answer as a [screen](docs/screens.md): the model picks what to
show, the numbers come from the server.

Also custom probes, the server's own log and config, any number of servers,
English and Turkish, and it installs as a PWA.

## Run it

You need [Bun](https://bun.sh) and a remon-server you can reach from the
browser.

```sh
bun install
bun dev
```

First run asks for a master password for the vault. Then pair a server:

1. On the server, run `sudo remon-server pair`. It prints an 8-digit code that
   lasts five minutes. Add `--role viewer` or `--role operator` for a device
   that should see or do less.
2. In the app, go to **Servers, Add server** and enter the server's URL and the
   code.

A device already paired as admin can also hand out a code from **Settings, Pair
another device**.

## Roles

Every paired device has a role. The server decides what each one may do; the
app only hides what the server would refuse anyway.

| role       | can                                                                                 |
| ---------- | ----------------------------------------------------------------------------------- |
| `viewer`   | see metrics, alerts and events; no logs, changes nothing                            |
| `operator` | also read logs, restart services, kill processes, silence alerts, ask the assistant |
| `admin`    | also pair devices, edit rules, channels and config, open a shell                    |

## Vault

Server credentials are encrypted with AES-256-GCM under a key derived from the
master password (PBKDF2-SHA256, 600k iterations). The password never leaves the
browser, and nobody can recover it for you.

On your own machine you can skip the password: the master key is then wrapped
by a non-extractable key kept in IndexedDB. Anyone who opens that browser gets
in, so leave it off on shared machines.

## Deploy

`bun run build` writes a static SPA to `build/`. Any static host works if:

- it serves the app from the root of its origin, not a subpath
- unknown paths fall back to `index.html`
- it is HTTPS (or localhost), since the vault, the service worker and push all
  need a secure context
- the server's CORS lets this origin in:

```toml
[cors]
allow_any_origin = false
allowed_origins = ["https://remon.example.com"]
```

With Caddy:

```caddy
remon.example.com {
	root * /var/www/remon-web
	try_files {path} /index.html
	file_server
}
```

Run as root on Linux, `bun run build` also syncs `build/` into
`/var/www/remon-web` if that directory exists (`scripts/deploy-caddy.sh`).
Anywhere else that step is skipped.

## Develop

```sh
bun run check   # types, needs src/lib/paraglide from a dev or build run
bun test
bun run lint
```

`vite build` does not type-check, so run all three before shipping. Strings live
in `messages/en.json` and `messages/tr.json`, and both keep the same keys.

Built with SvelteKit 2 and Svelte 5, Tailwind 4, ECharts, TanStack Query,
xterm.js and paraglide-js.
