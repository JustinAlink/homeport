<template>
  <div class="mx-auto max-w-[1300px] px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex items-center gap-3">
      <NuxtLink to="/" class="text-slate-400 hover:text-slate-200" aria-label="Back"><Icon name="arrow-left" class="h-[18px] w-[18px]" /></NuxtLink>
      <h1 class="text-xl font-semibold text-slate-100">Settings</h1>
    </header>

    <div
      v-if="loaded && !writable"
      class="mb-5 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300"
    >
      Settings storage isn't writable — mount a writable volume at <code>HOMEPORT_DATA_DIR</code> to save changes.
      You can still configure everything via environment variables.
    </div>

    <div v-if="loaded" class="gap-8 md:flex">
      <!-- section nav (sticky on desktop) -->
      <nav class="mb-4 hidden w-44 shrink-0 md:block">
        <ul class="sticky top-6 space-y-0.5 text-sm">
          <li v-for="s in sections" :key="s.id">
            <a
              :href="`#${s.id}`"
              class="block rounded-md px-2.5 py-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200"
              :class="active === s.id ? 'bg-white/5 text-accent-light' : ''"
              @click="active = s.id"
            >{{ s.label }}</a>
          </li>
        </ul>
      </nav>

      <form class="min-w-0 flex-1 space-y-8" @submit.prevent="save">
        <!-- first-run hint -->
        <div
          v-if="showProviderHint"
          class="rounded-md border border-sky-400/20 bg-sky-400/5 p-3 text-xs text-sky-200/90"
        >
          No reverse proxy is configured yet, so domains aren't mapped. Pick one under
          <a href="#proxy" class="underline">Reverse proxy</a>, or ignore this if you only want container status.
        </div>

      <!-- Docker connection -->
      <section :id="'docker'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Docker connection</h2>
        <p v-if="locked.docker" class="text-xs text-slate-500">Set by <code>DOCKER_HOST</code> — locked.</p>
        <div class="space-y-3" :class="locked.docker ? 'pointer-events-none opacity-50' : ''">
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input v-model="form.dockerMode" type="radio" value="local" /> Local socket / proxy
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input v-model="form.dockerMode" type="radio" value="ssh" /> Remote over SSH
          </label>
          <div v-if="form.dockerMode === 'ssh'" class="space-y-2 pl-6">
            <input v-model="form.dockerHost" :class="fieldCls" placeholder="ssh://user@host" />
            <input v-model="form.dockerSshKey" :class="fieldCls" placeholder="/ssh/id_ed25519  (key path, mounted read-only)" />
            <input
              v-model="form.dockerSshFingerprint"
              :class="[fieldCls, locked.dockerSshFingerprint ? 'pointer-events-none opacity-50' : '']"
              placeholder="SHA256:…  host key fingerprint (optional, recommended)"
            />
            <p class="text-[11px] text-slate-500">
              Pin the host key to reject a changed/spoofed server. Get it with
              <code>ssh-keyscan host | ssh-keygen -lf -</code>.
              <span v-if="locked.dockerSshFingerprint">Set by <code>DOCKER_SSH_FINGERPRINT</code> — locked.</span>
            </p>
          </div>
        </div>
        <p class="text-[11px] text-slate-500">
          This single connection is used when the multi-host list below is empty.
        </p>
        <TestButton label="Test Docker connection" :run="testDocker" />
      </section>

      <!-- Hosts (multi-host) -->
      <section :id="'hosts'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Hosts</h2>
        <p v-if="locked.hosts" class="text-xs text-slate-500">Set by <code>HOMEPORT_HOSTS</code> — locked.</p>
        <p class="text-xs text-slate-500">
          Watch more than one Docker host. Leave empty to use the single connection above.
        </p>
        <div class="space-y-4" :class="locked.hosts ? 'pointer-events-none opacity-50' : ''">
          <div
            v-for="(h, i) in form.hosts"
            :key="i"
            class="space-y-2 rounded-md border border-white/10 bg-ink-900/60 p-3"
          >
            <div class="flex items-center gap-2">
              <input v-model="h.name" :class="fieldCls" placeholder="Display name (e.g. vps-1)" />
              <button
                type="button"
                class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
                @click="form.hosts.splice(i, 1)"
              >
                Remove
              </button>
            </div>
            <input v-model="h.dockerHost" :class="fieldCls" placeholder="ssh://user@host  or  tcp://host:2375  (empty = local socket)" />
            <div v-if="(h.dockerHost || '').startsWith('ssh://')" class="space-y-2 pl-3">
              <input v-model="h.dockerSshKey" :class="fieldCls" placeholder="/ssh/id_ed25519  (key path)" />
              <input v-model="h.sshFingerprint" :class="fieldCls" placeholder="SHA256:…  host key fingerprint (optional, recommended)" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <select v-model="h.domainProvider" :class="fieldCls">
                <option value="">Proxy: auto / none</option>
                <option value="npm">Nginx Proxy Manager</option>
                <option value="nginx">Nginx (plain)</option>
                <option value="traefik">Traefik (labels)</option>
                <option value="traefik-file">Traefik (file)</option>
                <option value="caddy">Caddy</option>
              </select>
              <input
                v-if="h.domainProvider === 'npm'"
                v-model="h.npmConfDir"
                :class="fieldCls"
                placeholder="NPM proxy_host dir"
              />
              <input
                v-else-if="h.domainProvider === 'nginx'"
                v-model="h.nginxConfDir"
                :class="fieldCls"
                placeholder="Nginx confs dir/file"
              />
              <input
                v-else-if="h.domainProvider === 'traefik-file'"
                v-model="h.traefikFilePath"
                :class="fieldCls"
                placeholder="Traefik config file/dir"
              />
              <input
                v-else-if="h.domainProvider === 'caddy'"
                v-model="h.caddyfilePath"
                :class="fieldCls"
                placeholder="Caddyfile path"
              />
            </div>
          </div>
          <button
            type="button"
            class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-accent/40 hover:text-accent"
            @click="addHost"
          >
            + Add host
          </button>
        </div>
      </section>

      <!-- Reverse proxy -->
      <section :id="'proxy'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Reverse proxy (domain mapping)</h2>
        <p v-if="locked.domainProvider" class="text-xs text-slate-500">Set by <code>DOMAIN_PROVIDER</code> — locked.</p>
        <div class="space-y-3" :class="locked.domainProvider ? 'pointer-events-none opacity-50' : ''">
          <select v-model="form.domainProvider" :class="fieldCls">
            <option value="">Auto-detect</option>
            <option value="npm">Nginx Proxy Manager</option>
            <option value="nginx">Nginx (plain)</option>
            <option value="traefik">Traefik (labels)</option>
            <option value="traefik-file">Traefik (file)</option>
            <option value="caddy">Caddy</option>
          </select>
          <input
            v-if="form.domainProvider === 'npm' || (form.domainProvider === '' && form.npmConfDir)"
            v-model="form.npmConfDir"
            :class="fieldCls"
            placeholder="NPM proxy_host dir (in-container path)"
          />
          <input
            v-if="form.domainProvider === 'nginx'"
            v-model="form.nginxConfDir"
            :class="fieldCls"
            placeholder="Nginx confs dir or file (e.g. /nginx/sites-enabled)"
          />
          <input
            v-if="form.domainProvider === 'traefik-file'"
            v-model="form.traefikFilePath"
            :class="fieldCls"
            placeholder="Traefik dynamic config file/dir (YAML or TOML)"
          />
          <input
            v-if="form.domainProvider === 'caddy'"
            v-model="form.caddyfilePath"
            :class="fieldCls"
            placeholder="Caddyfile path (in-container)"
          />
        </div>
        <TestButton label="Test provider" :run="testProvider" />
      </section>

      <!-- Proxy management (write side) -->
      <section :id="'proxy-admin'"  v-if="form.allowProxyAdmin" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Proxy management</h2>
        <p class="text-xs text-slate-500">
          Credentials homeport uses to create/edit domains. Stored in <code>settings.json</code> on the
          data volume — set its file permissions accordingly.
        </p>

        <div v-if="form.domainProvider === 'npm' || form.domainProvider === ''" class="space-y-2">
          <p v-if="locked.npmApiUrl" class="text-xs text-slate-500">Set by <code>HOMEPORT_NPM_API_URL</code> — locked.</p>
          <input v-model="form.npmApiUrl" :class="fieldCls" placeholder="NPM API URL (e.g. http://npm:81)" />
          <input v-model="form.npmApiIdentity" :class="fieldCls" placeholder="NPM email / identity" />
          <input v-model="form.npmApiSecret" type="password" :class="fieldCls" placeholder="NPM password" />
        </div>
        <div v-if="form.domainProvider === 'caddy'" class="space-y-2">
          <input v-model="form.caddyAdminUrl" :class="fieldCls" placeholder="Caddy admin API (e.g. http://caddy:2019)" />
          <p class="text-[11px] text-slate-500">The admin API is root-of-proxy — keep it on a private network, never published.</p>
        </div>
        <p v-if="form.domainProvider === 'traefik-file'" class="text-[11px] text-slate-500">
          Traefik file admin writes a <code>homeport.yml</code> in the dynamic-config dir (or only
          <code>homeport-*</code> keys in a single file). Mount it <strong>read-write</strong>.
        </p>

        <div class="flex items-center gap-3">
          <button
            type="button"
            :disabled="proxyTesting"
            class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
            @click="testProxy"
          >{{ proxyTesting ? 'Testing…' : 'Test connection' }}</button>
          <span v-if="proxyMsg" class="text-[11px]" :class="proxyOk ? 'text-accent-light' : 'text-red-400'">{{ proxyMsg }}</span>
        </div>
      </section>

      <!-- Capabilities (tiered opt-in) -->
      <section :id="'capabilities'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Capabilities</h2>
        <p class="text-xs text-slate-500">
          homeport is read-only by default. Each capability is its own opt-in; the hint shows what the
          docker-socket-proxy must allow for it.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            :disabled="probing"
            class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
            @click="runCapProbe"
          >{{ probing ? 'Probing…' : 'Probe proxy permissions' }}</button>
          <span class="text-[11px] text-slate-600">
            checks what the Docker socket (proxy) actually allows — a toggle can be on here and still 403 at the proxy
          </span>
          <span v-if="probeErr" class="basis-full text-[11px] text-red-400">{{ probeErr }}</span>
        </div>
        <div class="space-y-2.5">
          <label
            v-for="c in capabilityToggles"
            :key="c.key"
            class="flex items-start gap-2 text-sm text-slate-200"
            :class="locked[c.lock] ? 'pointer-events-none opacity-50' : ''"
          >
            <input v-model="(form as any)[c.key]" type="checkbox" class="mt-0.5" />
            <span>
              {{ c.label }}
              <span
                v-for="v in probeChips(c.key)"
                :key="v.host"
                class="ml-2 inline-block rounded-full border px-1.5 py-px align-[1px] text-[10px]"
                :class="v.cls"
                :title="v.title"
              >{{ v.text }}</span>
              <span class="block text-[11px] text-slate-500">
                {{ c.hint }}<template v-if="locked[c.lock]"> · set by <code>{{ c.env }}</code> — locked</template>
              </span>
            </span>
          </label>
        </div>
      </section>

      <!-- App catalog -->
      <section :id="'catalog'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">App catalog</h2>
        <p class="text-xs text-slate-500">
          Extra template sources for the <NuxtLink to="/catalog" class="text-accent-light hover:underline">catalog</NuxtLink> —
          homeport-native or Portainer <code>templates.json</code> URLs, fetched server-side.
          <template v-if="locked.catalogUrls"> Set by <code>HOMEPORT_CATALOG_URLS</code> — locked.</template>
        </p>
        <div class="space-y-2" :class="locked.catalogUrls ? 'pointer-events-none opacity-50' : ''">
          <div v-for="(u, i) in form.catalogUrls" :key="i" class="flex items-center gap-2">
            <input
              v-model="form.catalogUrls[i]"
              :class="fieldCls"
              placeholder="https://raw.githubusercontent.com/…/templates.json"
            />
            <button
              type="button"
              class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
              @click="form.catalogUrls.splice(i, 1)"
            >Remove</button>
          </div>
          <button
            type="button"
            class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            @click="form.catalogUrls.push('')"
          >+ Add source</button>
          <div v-if="suggestedSources.length" class="flex flex-wrap items-center gap-1.5 pt-1">
            <span class="text-[11px] text-slate-600">Suggested:</span>
            <button
              v-for="s in suggestedSources"
              :key="s.url"
              type="button"
              class="rounded-full border border-sky-400/25 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-sky-400/10"
              :title="s.url"
              @click="form.catalogUrls.push(s.url)"
            >+ {{ s.name }}</button>
          </div>
        </div>
      </section>

      <!-- Uptime -->
      <section :id="'uptime'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Uptime</h2>
        <p v-if="locked.pingEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_PING</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.pingEnabled ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.pingEnabled" type="checkbox" />
          HTTP-ping mapped domains
          <span class="text-[11px] text-slate-500">(up/down dot on each domain)</span>
        </label>
      </section>

      <!-- Host services -->
      <section :id="'systemd'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Host services</h2>
        <p v-if="locked.systemdEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_SYSTEMD</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.systemdEnabled ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.systemdEnabled" type="checkbox" />
          Show systemd services
          <span class="text-[11px] text-slate-500">(needs <code>systemctl</code> access — host install or mounted)</span>
        </label>
      </section>

      <!-- Monitoring -->
      <section :id="'monitoring'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Monitoring</h2>
        <p v-if="locked.collectorInterval" class="text-xs text-slate-500">
          Interval set by <code>HOMEPORT_COLLECTOR_INTERVAL</code> — locked.
        </p>
        <label class="block text-sm text-slate-200">
          Background collector interval (seconds)
          <input
            v-model.number="form.collectorInterval"
            type="number"
            min="10"
            :class="[fieldCls, 'mt-1', locked.collectorInterval ? 'pointer-events-none opacity-50' : '']"
          />
          <span class="text-[11px] text-slate-500">
            How often homeport snapshots the fleet in the background to feed history and alerts. Minimum 10.
          </span>
        </label>
        <p v-if="locked.historyEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_HISTORY</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.historyEnabled ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.historyEnabled" type="checkbox" />
          Keep CPU/RAM history
          <span class="text-[11px] text-slate-500">(graphs survive refresh/restart; stored under the data dir)</span>
        </label>
      </section>

      <!-- Alerts & notifications -->
      <section :id="'alerts'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Alerts &amp; notifications</h2>
        <p v-if="locked.alerts" class="text-xs text-slate-500">Set by <code>HOMEPORT_ALERTS</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.alerts ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.alertsEnabled" type="checkbox" />
          Notify on service state changes
        </label>

        <div v-if="form.alertsEnabled" class="space-y-4 border-l border-white/5 pl-3">
          <div class="flex flex-wrap gap-4 text-sm text-slate-300">
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.down" type="checkbox" /> Down</label>
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.unhealthy" type="checkbox" /> Unhealthy</label>
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.recovered" type="checkbox" /> Recovered</label>
          </div>

          <label class="flex items-start gap-2 text-sm text-slate-200">
            <input v-model="form.alertUpdates" type="checkbox" class="mt-0.5" />
            <span>
              Notify when image updates are found
              <span class="block text-[11px] text-slate-500">one message per new image digest, sent when the daily check (or “Check now”) discovers it — needs update checks enabled</span>
            </span>
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="block text-xs text-slate-400">
              Debounce (samples)
              <input v-model.number="form.alertDebounceSamples" type="number" min="1" :class="[fieldCls, 'mt-1']" />
            </label>
            <label class="block text-xs text-slate-400">
              Re-notify cooldown (seconds)
              <input v-model.number="form.alertCooldownSec" type="number" min="0" :class="[fieldCls, 'mt-1']" />
            </label>
          </div>

          <div class="space-y-3">
            <p class="text-xs text-slate-500">Webhook channels (Discord / Slack / ntfy / custom). Add <code>hub.noalert=true</code> on a container to exclude it.</p>
            <div
              v-for="(ch, i) in form.alertChannels"
              :key="i"
              class="space-y-2 rounded-md border border-white/10 bg-ink-900/60 p-3"
            >
              <div class="flex items-center gap-2">
                <input v-model="ch.name" :class="fieldCls" placeholder="Channel name" />
                <select v-model="ch.preset" :class="[fieldCls, 'max-w-[8rem]']">
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="ntfy">ntfy</option>
                  <option value="custom">Custom</option>
                </select>
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
                  @click="form.alertChannels.splice(i, 1)"
                >
                  Remove
                </button>
              </div>
              <input v-model="ch.url" :class="fieldCls" placeholder="Webhook URL (https://…)" />
              <textarea
                v-if="ch.preset === 'custom'"
                v-model="ch.template"
                :class="[fieldCls, 'font-mono text-xs']"
                rows="2"
                placeholder='{"text":"{{text}}"}  — placeholders: {{name}} {{kind}} {{host}} {{from}} {{to}}'
              />
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-accent/40 hover:text-accent"
                @click="addChannel"
              >
                + Add channel
              </button>
              <button
                type="button"
                :disabled="testing || (!form.alertChannels.length && !form.smtpHost)"
                class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
                @click="sendTest"
              >
                {{ testing ? 'Sending…' : 'Send test' }}
              </button>
              <span v-if="testMsg" class="text-[11px]" :class="testOk ? 'text-accent-light' : 'text-red-400'">{{ testMsg }}</span>
            </div>
          </div>

          <!-- email (SMTP) channel -->
          <div class="space-y-2">
            <p class="text-xs text-slate-500">
              Email channel (SMTP) — leave the server empty to disable. Uses implicit TLS when “TLS from the start”
              is checked (port 465), otherwise STARTTLS is used when the server offers it (587). “Send test” covers it.
            </p>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input v-model="form.smtpHost" :class="fieldCls" placeholder="smtp.example.com" />
              <div class="flex items-center gap-3">
                <input v-model.number="form.smtpPort" type="number" min="1" max="65535" :class="[fieldCls, 'max-w-[7rem]']" placeholder="587" />
                <label class="flex items-center gap-1.5 text-xs text-slate-300">
                  <input v-model="form.smtpSecure" type="checkbox" /> TLS from the start (465)
                </label>
              </div>
              <input v-model="form.smtpUser" :class="fieldCls" placeholder="username (optional)" autocomplete="off" />
              <input v-model="form.smtpPass" type="password" :class="fieldCls" placeholder="password (optional)" autocomplete="new-password" />
              <input v-model="form.smtpFrom" :class="fieldCls" placeholder="from — homeport@example.com" />
              <input v-model="form.smtpTo" :class="fieldCls" placeholder="to — you@example.com (comma for more)" />
            </div>
          </div>
        </div>
      </section>

      <!-- Automatic updates -->
      <section :id="'autoupdate'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Automatic updates</h2>
        <p class="text-xs text-slate-500">
          Once a day, in the hour you pick, homeport applies pending image updates to everything opted in below.
          Managed stacks update via <code>compose pull &amp;&amp; up</code>; other containers are pulled and recreated in
          place. homeport itself is always skipped (use Settings → About → Update). Needs
          <em>Check for image updates</em> and <em>Apply image updates</em> enabled above. Results go to your alert channels.
        </p>
        <label class="flex items-center gap-2 text-sm text-slate-200">
          <input v-model="form.autoUpdateEnabled" type="checkbox" />
          Apply updates automatically
        </label>
        <div v-if="form.autoUpdateEnabled" class="space-y-3 border-l border-white/5 pl-3">
          <label class="block text-xs text-slate-400">
            Daily window (server-local time)
            <select v-model.number="form.autoUpdateHour" :class="[fieldCls, 'mt-1 max-w-[10rem]']">
              <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}:00 – {{ String(h - 1).padStart(2, '0') }}:59</option>
            </select>
          </label>
          <div class="space-y-2">
            <p class="text-xs text-slate-500">
              Opt-in targets — a stack/project name or a container name per row (the Updates page has one-click
              toggles for these). A <code>hub.autoupdate=true</code> label opts a container in without listing it;
              <code>hub.autoupdate=false</code> always opts out.
            </p>
            <div v-for="(t, i) in form.autoUpdateTargets" :key="i" class="flex items-center gap-2">
              <input v-model="form.autoUpdateTargets[i]" :class="fieldCls" placeholder="stack/project or container name" />
              <button
                type="button"
                class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
                @click="form.autoUpdateTargets.splice(i, 1)"
              >Remove</button>
            </div>
            <button
              type="button"
              class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
              @click="form.autoUpdateTargets.push('')"
            >+ Add target</button>
          </div>
        </div>
      </section>

      <!-- Registry credentials (private images) -->
      <section v-if="form.updateCheckEnabled || form.allowUpdates" :id="'registries'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Registry credentials</h2>
        <p class="text-xs text-slate-500">
          Logins for checking and pulling <strong>private</strong> images (e.g. your own
          <code>ghcr.io</code> packages). Without these, homeport checks registries anonymously and private
          images fail with a <code>401</code>. For GHCR use a token with <code>read:packages</code> (add
          <code>write:packages</code> only if you also apply updates). Stored in <code>settings.json</code> on the
          data volume — set its file permissions accordingly.
        </p>
        <p v-if="locked.registryCreds" class="text-xs text-slate-500">Set by <code>HOMEPORT_REGISTRY_AUTH</code> — locked.</p>
        <template v-else>
          <div v-for="(c, i) in form.registryCreds" :key="i" class="flex flex-wrap items-center gap-2">
            <input v-model="c.registry" :class="[fieldCls, 'min-w-[9rem] flex-1']" placeholder="registry host (e.g. ghcr.io)" />
            <input v-model="c.username" :class="[fieldCls, 'min-w-[8rem] flex-1']" placeholder="username" autocomplete="off" />
            <input v-model="c.token" type="password" :class="[fieldCls, 'min-w-[10rem] flex-1']" placeholder="token / password" autocomplete="new-password" />
            <button
              type="button"
              class="shrink-0 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-400 hover:border-red-400/40 hover:text-red-300"
              @click="form.registryCreds.splice(i, 1)"
            >Remove</button>
          </div>
          <button
            type="button"
            class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            @click="form.registryCreds.push({ registry: '', username: '', token: '' })"
          >+ Add registry login</button>
        </template>
      </section>

      <!-- Backup & restore -->
      <section :id="'backup'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Backup</h2>
        <p class="text-xs text-slate-500">
          Everything homeport persists — settings, hosts, alert channels, proxy credentials, the admin password hash
          and stack git tokens — in one JSON file. <strong class="text-amber-300/90">It contains secrets; store it like a password.</strong>
          Compose files in the stacks directory aren't included (they live outside the data dir — keep those in git).
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            @click="downloadBackup"
          >Download backup</button>
          <button
            type="button"
            class="rounded-md border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            @click="restoreInput?.click()"
          >Restore from file…</button>
          <input ref="restoreInput" type="file" accept="application/json,.json" class="hidden" @change="restoreBackup" />
          <span v-if="backupMsg" class="basis-full text-[11px]" :class="backupOk ? 'text-accent-light' : 'text-red-400'">{{ backupMsg }}</span>
        </div>
      </section>

      <!-- Appearance -->
      <section :id="'appearance'"  class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Appearance</h2>
        <p v-if="locked.remoteIcons" class="text-xs text-slate-500">Set by <code>HOMEPORT_REMOTE_ICONS</code> — locked.</p>
        <label
          class="flex items-center gap-2 text-sm text-slate-200"
          :class="locked.remoteIcons ? 'pointer-events-none opacity-50' : ''"
        >
          <input v-model="form.remoteIcons" type="checkbox" />
          Fetch app logos from the dashboard-icons CDN
          <span class="text-[11px] text-slate-500">(off = offline monograms / your own icon URLs only)</span>
        </label>
      </section>

      <!-- Account -->
      <section :id="'account'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Account</h2>
        <p v-if="caps.passwordEnvLocked" class="text-xs text-slate-500">
          The admin password is set via <code>HOMEPORT_ADMIN_PASSWORD</code> — change it there.
        </p>
        <div v-else class="max-w-sm space-y-2">
          <input v-model="pw.current" type="password" :class="fieldCls" placeholder="Current password" autocomplete="current-password" />
          <input v-model="pw.next" type="password" :class="fieldCls" placeholder="New password" autocomplete="new-password" />
          <input v-model="pw.confirm" type="password" :class="fieldCls" placeholder="Confirm new password" autocomplete="new-password" />
          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="pwBusy"
              class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              @click="changePassword"
            >{{ pwBusy ? 'Saving…' : 'Change password' }}</button>
            <span v-if="pwMsg" class="text-[11px]" :class="pwOk ? 'text-accent-light' : 'text-red-400'">{{ pwMsg }}</span>
          </div>
        </div>
      </section>

      <!-- About / self-update -->
      <section :id="'about'" class="scroll-mt-6 space-y-3">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-slate-400">About</h2>
        <p class="text-xs text-slate-500">
          homeport <b class="text-slate-300">v{{ appVersion || '…' }}</b>
          <template v-if="caps.demo"> · demo mode</template>
        </p>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-accent/30 px-3 py-1.5 text-xs text-accent-light hover:bg-accent/10 disabled:opacity-40"
            :disabled="selfUpdating || !caps.updates && !caps.demo"
            @click="selfUpdate"
          ><Icon name="arrow-up" class="h-3.5 w-3.5" /> Update homeport</button>
          <span v-if="!caps.updates && !caps.demo" class="text-[11px] text-slate-500">needs the “Apply image updates” capability</span>
          <span v-if="selfUpdateMsg" class="text-[11px]" :class="selfUpdateOk ? 'text-accent-light' : 'text-red-400'">{{ selfUpdateMsg }}</span>
        </div>
        <p class="text-[11px] text-slate-600">
          Pulls the newest image and recreates this container from outside (a short-lived helper
          runs <code>compose pull && up -d</code>). The UI reconnects automatically.
        </p>
      </section>

      <div class="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-white/5 bg-ink-950/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <button
          type="submit"
          :disabled="busy || !writable"
          class="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-light disabled:opacity-50"
        >
          {{ busy ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="msg" class="text-xs" :class="msgOk ? 'text-accent-light' : 'text-red-400'">{{ msg }}</span>
      </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
const fieldCls =
  'w-full rounded-md border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-accent/50'

const loaded = ref(false)
const writable = ref(true)
const locked = ref<Record<string, boolean>>({})
const busy = ref(false)
const msg = ref('')
const msgOk = ref(false)

// section anchor nav
const active = ref('docker')
const sections = computed(() =>
  [
    { id: 'docker', label: 'Docker connection' },
    { id: 'hosts', label: 'Hosts' },
    { id: 'proxy', label: 'Reverse proxy' },
    ...(form.allowProxyAdmin ? [{ id: 'proxy-admin', label: 'Proxy management' }] : []),
    { id: 'capabilities', label: 'Capabilities' },
    { id: 'catalog', label: 'App catalog' },
    { id: 'uptime', label: 'Uptime' },
    { id: 'systemd', label: 'Host services' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'alerts', label: 'Alerts' },
    { id: 'autoupdate', label: 'Auto-update' },
    ...(form.updateCheckEnabled || form.allowUpdates ? [{ id: 'registries', label: 'Registry credentials' }] : []),
    { id: 'backup', label: 'Backup' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'account', label: 'Account' },
    { id: 'about', label: 'About' },
  ],
)

const { caps, load: loadCaps } = useCapabilities()

// --- about / self-update ---
const appVersion = ref('')
const selfUpdating = ref(false)
const selfUpdateMsg = ref('')
const selfUpdateOk = ref(false)

async function selfUpdate() {
  if (!window.confirm('Update homeport to the latest image? The UI will briefly disconnect while the container is recreated.')) return
  selfUpdating.value = true
  selfUpdateOk.value = false
  selfUpdateMsg.value = 'starting the update helper…'
  const before = appVersion.value
  try {
    await $fetch('/api/self-update', { method: 'POST' })
  } catch (e: any) {
    selfUpdateMsg.value = errMsg(e, 'could not start the update')
    selfUpdating.value = false
    return
  }
  if (caps.value.demo) {
    await new Promise((r) => setTimeout(r, 4000))
    selfUpdateOk.value = true
    selfUpdateMsg.value = 'updated (demo) — already current.'
    selfUpdating.value = false
    return
  }
  selfUpdateMsg.value = 'pulling the new image… the page will reconnect by itself.'
  const deadline = Date.now() + 5 * 60_000
  const poll = async () => {
    try {
      const v = await $fetch<{ version: string }>('/api/version', { timeout: 4000 })
      if (v.version && v.version !== before) {
        selfUpdateMsg.value = `updated to v${v.version} — reloading…`
        selfUpdateOk.value = true
        setTimeout(() => window.location.reload(), 1200)
        return
      }
    } catch {
      selfUpdateMsg.value = 'homeport is restarting… reconnecting.'
    }
    if (Date.now() < deadline) setTimeout(poll, 3000)
    else {
      selfUpdateMsg.value = 'still waiting — if this persists, check `docker ps` on the host.'
      selfUpdating.value = false
    }
  }
  setTimeout(poll, 4000)
}

// change password
const pw = reactive({ current: '', next: '', confirm: '' })
const pwBusy = ref(false)
const pwMsg = ref('')
const pwOk = ref(false)
async function changePassword() {
  if (pw.next !== pw.confirm) {
    pwOk.value = false
    pwMsg.value = 'New passwords do not match'
    return
  }
  pwBusy.value = true
  pwMsg.value = ''
  try {
    await $fetch('/api/account/password', { method: 'POST', body: { current: pw.current, password: pw.next } })
    pwOk.value = true
    pwMsg.value = 'Password changed.'
    pw.current = pw.next = pw.confirm = ''
  } catch (e: any) {
    pwOk.value = false
    pwMsg.value = errMsg(e, 'Could not change password')
  } finally {
    pwBusy.value = false
  }
}

const showProviderHint = computed(
  () => loaded.value && !form.domainProvider && !form.npmConfDir && !form.caddyfilePath && !form.nginxConfDir && !form.traefikFilePath,
)

// connection tests (shared TestButton)
async function testDocker() {
  const r = await $fetch<{ hosts: { name: string; ok: boolean; message: string }[] }>('/api/test/docker', { method: 'POST' })
  const ok = r.hosts.every((h) => h.ok)
  return { ok, message: r.hosts.map((h) => `${h.name}: ${h.message}`).join(' · ') }
}
async function testProvider() {
  const r = await $fetch<{ ok: boolean; provider: string | null; count?: number; samples?: string[]; message?: string }>('/api/test/provider', { method: 'POST' })
  return {
    ok: r.ok,
    message: r.ok ? `${r.provider}: ${r.count} route(s)${r.samples?.length ? ' · ' + r.samples.join(', ') : ''}` : r.message || 'no provider',
  }
}

const form = reactive({
  dockerMode: 'local',
  dockerHost: '',
  dockerSshKey: '',
  dockerSshFingerprint: '',
  domainProvider: '',
  npmConfDir: '',
  caddyfilePath: '',
  nginxConfDir: '',
  traefikFilePath: '',
  npmApiUrl: '',
  npmApiIdentity: '',
  npmApiSecret: '',
  caddyAdminUrl: '',
  allowControl: false,
  logsEnabled: true,
  updateCheckEnabled: false,
  allowUpdates: false,
  registryCreds: [] as RegistryCredRow[],
  allowStacks: false,
  catalogUrls: [] as string[],
  allowTerminal: false,
  allowProxyAdmin: false,
  pingEnabled: true,
  systemdEnabled: false,
  remoteIcons: true,
  collectorInterval: 30,
  historyEnabled: true,
  alertsEnabled: false,
  alertUpdates: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: '',
  smtpTo: '',
  autoUpdateEnabled: false,
  autoUpdateHour: 4,
  autoUpdateTargets: [] as string[],
  alertTransitions: { down: true, unhealthy: true, recovered: false },
  alertDebounceSamples: 3,
  alertCooldownSec: 3600,
  alertChannels: [] as ChannelRow[],
  hosts: [] as HostRow[],
})

// Known-good community template lists, offered as one-click additions.
const KNOWN_SOURCES = [
  { name: 'Portainer official', url: 'https://raw.githubusercontent.com/portainer/templates/master/templates-2.0.json' },
  { name: 'Lissy93 (aggregated)', url: 'https://raw.githubusercontent.com/Lissy93/portainer-templates/main/templates.json' },
  { name: 'SelfhostedPro', url: 'https://raw.githubusercontent.com/SelfhostedPro/selfhosted_templates/master/Template/portainer-v2.json' },
]
const suggestedSources = computed(() => KNOWN_SOURCES.filter((s) => !form.catalogUrls.includes(s.url)))

// Tiered capability toggles + the socket-proxy permissions each one needs.
const capabilityToggles = [
  { key: 'logsEnabled', lock: 'logsEnabled', env: 'HOMEPORT_LOGS', label: 'Container logs viewer', hint: 'read-tier — already covered by CONTAINERS=1 (on by default)' },
  { key: 'allowControl', lock: 'allowControl', env: 'HOMEPORT_ALLOW_CONTROL', label: 'Start / stop / restart / recreate / delete', hint: 'container lifecycle — needs POST=1 on the socket proxy' },
  { key: 'updateCheckEnabled', lock: 'updateCheckEnabled', env: 'HOMEPORT_UPDATE_CHECK', label: 'Check for image updates', hint: 'needs DISTRIBUTION=1 (read-only registry digests)' },
  { key: 'allowUpdates', lock: 'allowUpdates', env: 'HOMEPORT_ALLOW_UPDATES', label: 'Apply image updates (pull + recreate)', hint: 'needs IMAGES=1 POST=1' },
  { key: 'allowStacks', lock: 'allowStacks', env: 'HOMEPORT_ALLOW_STACKS', label: 'Compose stack management', hint: 'needs POST=1 CONTAINERS=1 IMAGES=1 NETWORKS=1 VOLUMES=1 + a mounted stacks dir' },
  { key: 'allowTerminal', lock: 'allowTerminal', env: 'HOMEPORT_ALLOW_TERMINAL', label: 'Web terminal (exec into containers)', hint: 'needs EXEC=1 POST=1 — full shell access, enable with care' },
  { key: 'allowProxyAdmin', lock: 'allowProxyAdmin', env: 'HOMEPORT_ALLOW_PROXY_ADMIN', label: 'Manage the reverse proxy (domains)', hint: 'talks to your proxy, not Docker — needs provider credentials below' },
] as const

interface ChannelRow {
  name: string
  url: string
  preset: 'discord' | 'slack' | 'ntfy' | 'custom'
  template?: string
}

interface RegistryCredRow {
  registry: string
  username: string
  token: string
}

function addChannel() {
  form.alertChannels.push({ name: '', url: '', preset: 'discord', template: '' })
}

// --- socket-proxy permission probe ---
// maps settings toggle keys → capability names in the probe response
const PROBE_CAP_OF: Record<string, string> = {
  allowControl: 'control',
  updateCheckEnabled: 'updateCheck',
  allowUpdates: 'updates',
  allowStacks: 'stacks',
  allowTerminal: 'terminal',
}
interface ProbeHost { name: string; probes: Record<string, string>; caps: Record<string, string> }
const probing = ref(false)
const probeErr = ref('')
const probeHosts = ref<ProbeHost[]>([])
async function runCapProbe() {
  probing.value = true
  probeErr.value = ''
  try {
    const r = await $fetch<{ hosts: ProbeHost[] }>('/api/test/capabilities', { method: 'POST' })
    probeHosts.value = r.hosts
  } catch (e: any) {
    probeErr.value = errMsg(e, 'probe failed')
  } finally {
    probing.value = false
  }
}
function probeChips(key: string) {
  const cap = PROBE_CAP_OF[key]
  if (!cap || !probeHosts.value.length) return []
  return probeHosts.value.map((h) => {
    const v = h.caps[cap] ?? 'unknown'
    const missing = Object.entries(h.probes)
      .filter(([, verdict]) => verdict === 'blocked')
      .map(([p]) => p.toUpperCase())
    return {
      host: h.name,
      text: (probeHosts.value.length > 1 ? `${h.name}: ` : 'proxy: ') + v,
      title: v === 'blocked' ? `blocked at the socket proxy — missing: ${missing.join(', ')}=1` : '',
      cls:
        v === 'allowed'
          ? 'border-ok/40 text-ok'
          : v === 'blocked'
            ? 'border-red-500/40 text-red-300'
            : 'border-amber-400/40 text-amber-300',
    }
  })
}

// --- backup & restore ---
const restoreInput = ref<HTMLInputElement | null>(null)
const backupMsg = ref('')
const backupOk = ref(true)

async function downloadBackup() {
  backupMsg.value = ''
  try {
    const r = await fetch('/api/backup')
    if (!r.ok) throw new Error(`export failed (${r.status})`)
    const blob = await r.blob()
    const name = r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'homeport-backup.json'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
    backupOk.value = true
    backupMsg.value = 'Backup downloaded — it contains secrets, store it safely.'
  } catch (e: any) {
    backupOk.value = false
    backupMsg.value = errMsg(e, 'could not export a backup')
  }
}

async function restoreBackup(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  ;(ev.target as HTMLInputElement).value = '' // allow re-picking the same file
  if (!file) return
  backupMsg.value = ''
  let parsed: any
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    backupOk.value = false
    backupMsg.value = 'That file is not valid JSON.'
    return
  }
  if (parsed?.format !== 'homeport-backup') {
    backupOk.value = false
    backupMsg.value = 'That file is not a homeport backup.'
    return
  }
  const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : 'unknown date'
  if (!window.confirm(`Replace ALL settings with the backup from ${when}?${parsed.demo ? '\n(Note: this backup was exported from a demo instance.)' : ''}\nIf it includes a different admin password/session secret, you will be logged out.`)) return
  try {
    const r = await $fetch<{ ok: boolean; authRestored: boolean; gitTokens: number }>('/api/backup', { method: 'POST', body: parsed })
    backupOk.value = true
    backupMsg.value = `Restored (git tokens: ${r.gitTokens}${r.authRestored ? ', auth file replaced' : ''}). Reloading…`
    // a restored session secret invalidates this session — a reload lands wherever auth says
    setTimeout(() => window.location.reload(), 1500)
  } catch (e: any) {
    backupOk.value = false
    backupMsg.value = errMsg(e, 'restore failed')
  }
}

const proxyTesting = ref(false)
const proxyMsg = ref('')
const proxyOk = ref(false)
async function testProxy() {
  proxyTesting.value = true
  proxyMsg.value = ''
  try {
    // persist creds first so the server tests what's on screen
    await $fetch('/api/settings', {
      method: 'POST',
      body: {
        allowProxyAdmin: true,
        npmApiUrl: form.npmApiUrl,
        npmApiIdentity: form.npmApiIdentity,
        npmApiSecret: form.npmApiSecret,
        caddyAdminUrl: form.caddyAdminUrl,
      },
    })
    const r = await $fetch<{ ok: boolean; message: string; provider: string }>('/api/proxy/test', { method: 'POST' })
    proxyOk.value = r.ok
    proxyMsg.value = `${r.provider}: ${r.message}`
  } catch (e: any) {
    proxyOk.value = false
    proxyMsg.value = errMsg(e, 'Test failed')
  } finally {
    proxyTesting.value = false
  }
}

const testMsg = ref('')
const testOk = ref(false)
const testing = ref(false)
async function sendTest() {
  testing.value = true
  testMsg.value = ''
  try {
    // persist current channels + smtp first so the server tests what's on screen
    await $fetch('/api/settings', {
      method: 'POST',
      body: {
        alertChannels: form.alertChannels,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpSecure: form.smtpSecure,
        smtpUser: form.smtpUser,
        smtpPass: form.smtpPass,
        smtpFrom: form.smtpFrom,
        smtpTo: form.smtpTo,
      },
    })
    const r = await $fetch<{ ok: boolean; channels: { name: string; ok: boolean; error?: string }[] }>('/api/alerts/test', {
      method: 'POST',
    })
    testOk.value = r.ok
    testMsg.value = r.channels.map((c) => `${c.name}: ${c.ok ? 'ok' : c.error || 'failed'}`).join(' · ')
  } catch (e: any) {
    testOk.value = false
    testMsg.value = errMsg(e, 'Test failed')
  } finally {
    testing.value = false
  }
}

interface HostRow {
  id?: string
  name: string
  dockerHost: string
  dockerSshKey: string
  sshFingerprint: string
  domainProvider: string
  npmConfDir: string
  caddyfilePath: string
  nginxConfDir: string
  traefikFilePath: string
}

function addHost() {
  form.hosts.push({
    name: '',
    dockerHost: '',
    dockerSshKey: '',
    sshFingerprint: '',
    domainProvider: '',
    npmConfDir: '',
    caddyfilePath: '',
    nginxConfDir: '',
    traefikFilePath: '',
  })
}

onMounted(async () => {
  loadCaps()
  $fetch<{ version: string }>('/api/version')
    .then((v) => (appVersion.value = v.version))
    .catch(() => {})
  try {
    const r = await $fetch<any>('/api/settings')
    Object.assign(form, r.settings)
    form.hosts = (r.settings.hosts ?? []).map((h: Partial<HostRow>) => ({
      id: h.id,
      name: h.name ?? '',
      dockerHost: h.dockerHost ?? '',
      dockerSshKey: h.dockerSshKey ?? '',
      sshFingerprint: h.sshFingerprint ?? '',
      domainProvider: h.domainProvider ?? '',
      npmConfDir: h.npmConfDir ?? '',
      caddyfilePath: h.caddyfilePath ?? '',
      nginxConfDir: h.nginxConfDir ?? '',
      traefikFilePath: h.traefikFilePath ?? '',
    }))
    form.alertChannels = (r.settings.alertChannels ?? []).map((c: Partial<ChannelRow>) => ({
      name: c.name ?? '',
      url: c.url ?? '',
      preset: c.preset ?? 'discord',
      template: c.template ?? '',
    }))
    form.registryCreds = (r.settings.registryCreds ?? []).map((c: Partial<RegistryCredRow>) => ({
      registry: c.registry ?? '',
      username: c.username ?? '',
      token: c.token ?? '',
    }))
    locked.value = r.locked
    writable.value = r.writable
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
  } finally {
    loaded.value = true
  }
})

async function save() {
  busy.value = true
  msg.value = ''
  try {
    await $fetch('/api/settings', { method: 'POST', body: { ...form } })
    msgOk.value = true
    msg.value = 'Saved.'
  } catch (e: any) {
    msgOk.value = false
    msg.value = errMsg(e, 'Save failed')
  } finally {
    busy.value = false
  }
}

useHead({ title: 'Settings — homeport' })
</script>
