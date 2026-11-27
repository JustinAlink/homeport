# Public status page

A read-only page at `/status` that anyone can open without logging in: for the
family, friends or band members who use your self-hosted apps and want to know
"is it me, or is it down?". It shows only what you pick, under the names you
give it, with uptime bars for the last 30 days.

It is **off by default**. While it is off, `/status` answers exactly like a page
that never existed, and nothing about it is public.

## Switching it on

**Settings → Monitoring & alerts → Public status page**

1. Tick **Publish the status page**.
2. Give the page a title (default "Status").
3. Optionally write a notice: plain text shown at the top, marked as Info,
   Maintenance or Problem. Leave it empty for none.
4. Under **Shown on the page**, press **Add apps and domains** and add what
   people should see. Rename each one: apps start with their friendly name
   (the `hub.name` label, else the compose service name), so change it when that
   name is one you would rather keep to yourself.
5. Optionally make more groups (**Add group**) and give them headings, move items
   up, down or into another group.
6. **Save changes**.

The section shows the page's address with a copy button, and a **Preview**
button. The preview works while the page is off and only for a signed-in admin,
so you can build the page before anyone can see it. It shows the saved settings.

To pin the switch, set `HOMEPORT_STATUS_PAGE=true` or `false`. The settings page
then shows it locked. With `false`, homeport also stops checking the picked
domains.

## What visitors see

- the title and the notice
- one line at the top: **All systems operational**, **Some systems are having
  problems**, **All systems are down**, **Some systems are not reporting** (some
  are unknown, the rest fine) or **Status unknown**
- per group, per item: its name, its state right now and its uptime over 24 hours,
  7 days and 30 days, plus one bar per day for 30 days
- when the page last updated; it refreshes every minute on its own and says so
  when a refresh fails (homeport runs on the same server as your apps: if the
  whole server is down, the page is too, and an open page says it lost contact)

States:

| State | App (container) | Domain |
|---|---|---|
| Operational | running, healthy or without a health check | answered (a login page or another 4xx counts: the app answered) |
| Degraded | running but failing its health check | |
| Down | stopped, restarting, paused, exited | no answer, or a 5xx |
| Unknown | not found (removed or renamed), or its host can't be reached | not checked in the last 5 minutes, or domain checks are off |

Uptime is the same figure as on the service page: running and not failing its
health check, checked by the background collector (every 30 seconds by default).
A day bar is green when the day had no downtime worth counting, amber for some
downtime, red when more than about an hour of it was down, and grey when there is
no data. Today's bar is never green while the item is down or degraded right now.
Figures are never rounded up to 100%. With history switched off, the bars are
grey and the figures say "No data".

The day bars work without a mouse: Tab to them, then use the arrow keys (Home,
End, Page Up and Page Down jump to the ends or by a week). Screen readers read each
day ("Tue 18 Nov: 99.31% up"). On a phone, tap a day.

The page follows the visitor's light or dark setting.

## What is public, and what never is

Visitors, and anyone calling `GET /api/public/status`, get only:

- the title, the notice and its kind
- the names you gave the picked items, and for a picked domain the domain name
- each item's state, its 24 h / 7 d / 30 d uptime and one figure per day
- the overall state and the time of the update

Never: container ids or names (unless you keep one as the display name), images,
hosts, ports, IP addresses, internal URLs, error messages, other containers, or
any setting. The answer is built field by field from that list, so a new field on
a container can't leak into it. Nothing appears unless you added it by hand.

The notice and the names are plain text. They are shown as text, never as HTML:
`<b>` shows up as the characters `<b>`. Line breaks in the notice are kept,
invisible characters (zero-width, text-direction overrides) are removed, and the
lengths are capped (title 80, notice 500, names 60, group headings 40, at most 20
groups and 50 items).

The page itself loads none of homeport's admin screens: no sidebar, no admin
requests, no login redirect, and no link into the admin app. The one link is a
small "Powered by homeport" to the project page. A browser that saves the page to
its home screen gets a shortcut to the status page, not to homeport's login.

## Load

A request for the page or its data never makes homeport talk to Docker, a
registry or a domain. App states come from the collector's last run and domain
states from the collector's own checks. The answer is cached for 30 seconds per
time zone (the day bars follow the visitor's calendar), so however often the page
is opened, homeport builds it at most once per time zone per 30 seconds. The
response says `Cache-Control: public, max-age=30`. A saved settings change shows
at once.

Each picked domain costs one check per collector run (shared with the domain
alerts, so a domain both alert and status page watch is checked once). homeport
starts recording a domain's uptime when you pick it, even while the page is off,
so the preview has data and the page has a history on the day it goes public.

## Putting only the status page on the internet

`/status` lives on the same address as homeport. If homeport itself should stay
private, give the status page its own host name in your reverse proxy and pass on
only what the page needs:

- `/status`
- `/api/public/status`
- `/_nuxt/` (the page's scripts, styles and fonts)
- `/favicon.ico`, `/icon.svg`, `/apple-touch-icon.png`

Everything else on that host name can answer 404. Example for Caddy:

```
status.example.com {
	@status path /status /api/public/status /_nuxt/* /favicon.ico /icon.svg /apple-touch-icon.png
	handle @status {
		reverse_proxy homeport:3000
	}
	respond 404
}
```

## API

```
GET /api/public/status[?tz=<minutes>]
```

No login while the page is on. `tz` is the visitor's
`Date#getTimezoneOffset()` (rounded to a quarter hour, UTC when left out); it
decides where the day bars start and end. While the page is off the path is
gated like every other `/api` path, so it answers the same as a path that never
existed: 401 without a session, 404 with one.

```json
{
  "title": "Home server status",
  "notice": "Jellyfin gets its update on Sunday evening.",
  "noticeKind": "maintenance",
  "overall": "operational",
  "groups": [
    {
      "name": "Watch and listen",
      "items": [
        {
          "name": "Movies and TV",
          "state": "operational",
          "uptime": { "24h": 1, "7d": 0.99602, "30d": 0.99907 },
          "days": [{ "from": 1793059200000, "ratio": 1 }]
        }
      ]
    }
  ],
  "updatedAt": 1795639083478
}
```

A domain item has `"domain": "blog.example.com"` as well. `ratio` is `null` for
a day without data; `days` holds 30 entries, oldest first. `overall` is one of
`operational`, `issues`, `outage`, `not-reporting`, `unknown`.

```
GET /api/status-page/preview[?tz=<minutes>]
```

The same answer while the page is off too, plus `preview: { enabled, locked }`.
Behind the normal login and admin-only: read-scope API tokens and read-only
accounts get 403. Not cached.

## Not included

One page per homeport, not a set of pages with their own addresses. No incident
history, scheduled maintenance windows, subscriptions or custom CSS: the notice
covers "something is going on" in plain words. Systemd units can't be added (they
have no uptime history).
