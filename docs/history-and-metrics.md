# History, uptime and Prometheus metrics

homeport keeps 30 days of CPU and memory history per container, works out each
container's uptime from the same samples, and offers both to Prometheus at
`/api/metrics`. Everything here is read-only and behind the normal login or an
API token.

## What is kept

The background collector (every `HOMEPORT_COLLECTOR_INTERVAL` seconds, 30 by
default) takes one sample of every container. Each sample goes into three tiers:

| Range     | Resolution             | Points | Used for                        |
|-----------|------------------------|--------|---------------------------------|
| 24 hours  | 1 minute (last sample) | 1440   | Live, 1h, 6h and 24h graphs     |
| 7 days    | 15 minute average      | 672    | the 7d graph, uptime up to 7 d  |
| 30 days   | 1 hour average         | 720    | the 30d graph, uptime to 30 d   |

The two long tiers average every collector sample that falls in a bucket, not
just the last one, so a short spike still moves the hour it happened in. The
graph tooltip says when a point is an average ("Sat 14 Nov, 11:00 · 1 h average").

Why these steps: a graph is 600 to 1000 pixels wide, so about 700 points per
range is roughly one point per pixel. Coarser buckets (2 h for a week, 8 h for a
month) read as blocky; finer ones only cost disk. Hourly for 30 days is also what
Uptime Kuma 2 keeps.

The fine tier still follows `HOMEPORT_HISTORY_RESOLUTION` (seconds per point,
default 60) and `HOMEPORT_HISTORY_RETENTION_HOURS` (default 24). The long tiers
are fixed. `/api/history` picks whichever tier covers the range with at most 1500
points, so a fine tier kept for a week still hands the 7d graph to the 15-minute
averages.

### Disk and memory

One file per container under `<data>/stats/` (plus `host.json` and
`host-system.json` for the dashboard graph). A container with a full 30 days of
data takes about 48 KB on disk and about 90 KB of memory. With 50 containers that
is about 2.5 MB on disk and 4.5 MB of memory. `HOMEPORT_HISTORY_MAX_SERIES`
(default 500) caps the number of series, so the worst case stays near 25 MB on
disk. Files are written every 5 minutes and on shutdown, through a temporary file
and a rename, so a crash never leaves a half-written file.

A container that is removed keeps its file for 30 days (long enough to come back
under the same name), then the file is deleted.

Switch history off with `HOMEPORT_HISTORY=false` or under
**Settings → Monitoring & alerts**. Uptime is recorded only while history is on.

## History survives recreates and updates

Series are keyed by host and container name (`default|jellyfin`), not by
container id. Updating an image, changing its environment or recreating the
container makes a new id, and before this every one of those started the graphs
from zero. Renaming a container starts a new series.

**Upgrading from an older homeport:** the old files were keyed by container id
(`c_<id>.json`, 24 hours at most). On the first collector run after the upgrade,
every container that still has the same id moves its last 24 hours into the new
file (and into the 7d and 30d averages, so those show that day straight away);
the old file is deleted once the new one is on disk. Old files of containers
that were recreated before the upgrade can not be matched to a name and are
deleted after 24 hours, which is all they could hold anyway. Uptime starts at the
upgrade: an old file only has points while the container ran, so its gaps can't
tell "stopped" from "homeport was off".

## Uptime

At every collector run a container counts as **up** when it is running and not
failing its health check. Precisely:

- `running` without a health check, `running (healthy)`, and `running (health: starting)` are up.
  A health check is only "starting" for its start period and a few retries, so
  counting it as down would charge every deliberate restart as an outage.
- `running (unhealthy)`, `restarting`, `paused`, `exited`, `created` and `dead` are down.

Uptime is up samples divided by observed samples. Time homeport itself was not
running is not observed and counts neither way, the same way Uptime Kuma treats
missing heartbeats. A remote host homeport can't reach is not observed either. A
container that is absent from the list for a moment (between the remove and the
create of a recreate) is not sampled, so a recreate faster than one collector
interval does not show as downtime; a slow one shows as down only for the runs
that saw it stopped.

The service page's **Uptime** card shows 24 hours, 7 days and 30 days with the
estimated time down, plus one bar per calendar day in your time zone (green: up
all day, amber: some downtime, red: more than 5% of the day down, grey: no
data). Hover or tap a day for its figure. When homeport has watched a container
for less than 30 days the card says since when.

The figures are never rounded up to 100%: a minute down in a month reads 99.99%.
Time down is estimated as down samples times the collector interval.

### API

```
GET /api/uptime?id=<service id or "<hostId>|<name>">[&days=30][&tz=<minutes>]
```

returns `windows` (`24h`, `7d`, `30d`, each with `ratio`, `n`, `up`, `since`,
`downMs`) and `days` (one entry per calendar day; `tz` is the browser's
`Date#getTimezoneOffset()`, UTC when left out). `ratio` is `null` when nothing
was observed. `GET /api/uptime` without an id lists every container with its
three windows, keyed by host and name. On the server, `getUptime(key, rangeMs)`
in `server/utils/history.ts` is the one function both use; a status page can call
it too.

```
GET /api/history?id=<id>&range=<1h|6h|24h|7d|30d>
```

accepts ranges up to 30 days (`Nh` or `Nd`). `res` in the answer is the seconds
per point (60, 900 or 3600) and `t` the start of each point. `id` is a service id,
`host`, `host-system`, or a container key such as `default|jellyfin`.

## Prometheus metrics

`GET /api/metrics` answers in the Prometheus text format (0.0.4). It is behind
the normal auth like every `/api` path, so give Prometheus a **read-scope API
token** (Settings → Security & users → API tokens). A read token can only make GET
requests, and the metrics show nothing a read token can't already see in
`/api/services` and `/api/updates`, which is why there is no separate switch.

```yaml
scrape_configs:
  - job_name: homeport
    scheme: https
    metrics_path: /api/metrics
    scrape_interval: 30s
    authorization:
      credentials: hp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    static_configs:
      - targets: ['homeport.example.com']
```

Better: keep the token out of the config file with
`authorization: { credentials_file: /etc/prometheus/homeport-token }`. The type
defaults to `Bearer`, which is what homeport expects.

A scrape never waits on Docker, a registry or a website. Container values come
from the collector's last run (`homeport_collector_last_run_timestamp_seconds`
says when), so there is no point scraping more often than the collector runs.
Until the first run after a start, the endpoint answers 503, which Prometheus
records as a failed scrape (`up == 0`) rather than as fake zeros. Domain results
come from the last checks homeport made and are refreshed in the background at
most once a minute; results older than 5 minutes are left out.

| Metric | Labels | Meaning |
|---|---|---|
| `homeport_build_info` | `version` | always 1 |
| `homeport_collector_last_run_timestamp_seconds` | | when the values below were taken |
| `homeport_host_up` | `host` | 1 when homeport can reach the Docker host |
| `homeport_container_info` | `name`, `host`, `project`, `image` | always 1, join on it for the image |
| `homeport_container_up` | `name`, `host`, `project` | 1 running, 0 not |
| `homeport_container_health_status` | ... `status` | one series per state (`healthy`, `unhealthy`, `starting`), 1 on the current one; only containers with a health check |
| `homeport_container_cpu_usage_ratio` | `name`, `host`, `project` | CPU in cores: 1 = one full core (docker stats' 100%), the scale of cAdvisor's `rate(container_cpu_usage_seconds_total[1m])` |
| `homeport_container_memory_usage_bytes` | `name`, `host`, `project` | memory as docker stats shows it (page cache excluded) |
| `homeport_container_update_available` | `name`, `host`, `project` | 1 when the registry has a newer image for the tag; absent while update checks are off |
| `homeport_container_uptime_ratio` | ... `window` (`24h`, `7d`, `30d`) | uptime as above, 0 to 1 |
| `homeport_domain_probe_success` | `domain`, `name`, `host` | 1 when the domain answered (a 4xx counts: the app answered), 0 on no answer or a 5xx |
| `homeport_domain_probe_duration_seconds` | `domain`, `name`, `host` | how long the last check took |
| `homeport_domain_probe_http_status_code` | `domain`, `name`, `host` | HTTP status, 0 for no answer |

`host` is the host id (`default` for a single host), which stays put when a
host's display name is edited. `name` is the Docker container name. CPU and
memory are left out for a stopped container rather than reported as 0. The
domain families are left out when domain checks are off.

Not exported: a restart count. Docker only reports it per container through an
inspect call, and a scrape must not run one per container.

Example alert rules:

```yaml
groups:
  - name: homeport
    rules:
      - alert: ContainerDown
        expr: homeport_container_up == 0
        for: 5m
      - alert: ContainerUnhealthy
        expr: homeport_container_health_status{status="unhealthy"} == 1
        for: 5m
      - alert: DomainDown
        expr: homeport_domain_probe_success == 0
        for: 5m
      - alert: LowMonthlyUptime
        expr: homeport_container_uptime_ratio{window="30d"} < 0.99
```
