<template>
  <div class="page">
    <PageHeader title="Settings" subtitle="How homeport reaches Docker, what it may change, and who can sign in. Values set by environment variables are shown locked." />

    <div v-if="loaded && !writable" class="callout callout-warn mb-5">
      <Icon name="alert" />
      <span>Settings storage isn't writable. Mount a writable volume at <code>HOMEPORT_DATA_DIR</code> to save changes;
        you can still configure everything with environment variables.</span>
    </div>

    <div v-if="loaded && caps.viewer" class="card">
      <EmptyState icon="lock" title="Settings are admin-only" text="Read-only accounts can view the fleet but not change how homeport is configured." />
    </div>

    <div v-else-if="!loaded" class="gap-8 lg:flex">
      <div class="mb-4 hidden w-56 shrink-0 space-y-1.5 lg:block"><div v-for="i in 7" :key="i" class="skeleton h-9" /></div>
      <div class="min-w-0 flex-1 space-y-4"><div v-for="i in 3" :key="i" class="card h-40" /></div>
    </div>

    <div v-else class="gap-8 lg:flex">
      <!-- category nav: a sticky list on desktop, a scrolling strip on small screens -->
      <nav class="-mx-4 mb-5 overflow-x-auto px-4 lg:mx-0 lg:mb-0 lg:w-56 lg:shrink-0 lg:overflow-visible lg:px-0" aria-label="Settings sections">
        <ul class="flex min-w-max gap-1 lg:sticky lg:top-8 lg:min-w-0 lg:flex-col">
          <li v-for="c in categories" :key="c.id">
            <button
              type="button"
              class="flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-left text-[13.5px] transition-colors"
              :class="category === c.id ? 'bg-white/[0.07] font-medium text-slate-100' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'"
              @click="category = c.id"
            >
              <Icon :name="c.icon" class="h-4 w-4 shrink-0" :class="category === c.id ? 'text-accent-light' : 'text-slate-500'" />
              {{ c.label }}
            </button>
          </li>
        </ul>
      </nav>

      <form class="min-w-0 max-w-3xl flex-1 space-y-5" @submit.prevent="save">

        <!-- first-run hint -->
        <div v-if="showProviderHint && category === 'connection'" class="callout callout-info">
          <Icon name="info" />
          <span>No reverse proxy is configured yet, so domains aren't mapped. Pick one under
            <button type="button" class="link" @click="category = 'proxy'">Reverse proxy</button>, or ignore this if you only want container status.</span>
        </div>

      <!-- Docker connection -->
      <section v-show="inCategory('docker')" :id="'docker'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Docker connection</h2>
        <p v-if="locked.docker" class="text-xs text-slate-500">Set by <code>DOCKER_HOST</code> — locked.</p>
        <div class="space-y-3" :class="locked.docker ? 'is-locked' : ''">
          <label class="check">
            <input v-model="form.dockerMode" type="radio" value="local" /> Local socket / proxy
          </label>
          <label class="check">
            <input v-model="form.dockerMode" type="radio" value="ssh" /> Remote over SSH
          </label>
          <div v-if="form.dockerMode === 'ssh'" class="grid gap-3 pl-6 sm:grid-cols-2">
            <Field v-slot="{ id }" label="SSH address">
              <input :id="id" v-model="form.dockerHost" class="input font-mono" placeholder="ssh://user@host" spellcheck="false" />
            </Field>
            <Field v-slot="{ id }" label="Private key path" hint="Inside the container, mounted read-only.">
              <input :id="id" v-model="form.dockerSshKey" class="input font-mono" placeholder="/ssh/id_ed25519" spellcheck="false" />
            </Field>
            <Field label="Host key fingerprint" optional class="sm:col-span-2">
              <template #default="{ id }">
                <input
                  :id="id"
                  v-model="form.dockerSshFingerprint"
                  class="input font-mono" :class="[locked.dockerSshFingerprint ? 'is-locked' : '']"
                  placeholder="SHA256:…"
                  spellcheck="false"
                />
              </template>
              <template #hint>
                Recommended: rejects a changed or spoofed server. Get it with <code>ssh-keyscan host | ssh-keygen -lf -</code>.
                <span v-if="locked.dockerSshFingerprint">Set by <code>DOCKER_SSH_FINGERPRINT</code>, locked.</span>
              </template>
            </Field>
          </div>
        </div>
        <p class="text-[11px] text-slate-500">
          This single connection is used when the multi-host list below is empty.
        </p>
        <TestButton label="Test Docker connection" :run="testDocker" />
      </section>

      <!-- Hosts (multi-host) -->
      <section v-show="inCategory('hosts')" :id="'hosts'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Hosts</h2>
        <p v-if="locked.hosts" class="text-xs text-slate-500">Set by <code>HOMEPORT_HOSTS</code> — locked.</p>
        <p class="text-xs text-slate-500">
          Watch more than one Docker host. Leave empty to use the single connection above.
        </p>
        <div class="space-y-4" :class="locked.hosts ? 'is-locked' : ''">
          <div
            v-for="(h, i) in form.hosts"
            :key="i"
            class="space-y-2 rounded-lg border border-white/[0.08] bg-ink-950/40 p-3"
          >
            <div class="flex items-end gap-2">
              <Field v-slot="{ id }" label="Name" class="flex-1">
                <input :id="id" v-model="h.name" class="input" placeholder="e.g. vps-1" />
              </Field>
              <button
                type="button"
                class="btn btn-icon shrink-0 text-slate-400 hover:!border-red-500/40 hover:!text-red-300"
                :aria-label="`Remove host ${h.name || i + 1}`"
                title="Remove host"
                @click="form.hosts.splice(i, 1)"
              ><Icon name="trash" /></button>
            </div>
            <Field v-slot="{ id }" label="Docker address" hint="Empty uses the local socket.">
              <input :id="id" v-model="h.dockerHost" class="input font-mono" placeholder="ssh://user@host or tcp://host:2375" spellcheck="false" />
            </Field>
            <div v-if="(h.dockerHost || '').startsWith('ssh://')" class="grid gap-3 sm:grid-cols-2">
              <Field v-slot="{ id }" label="Private key path">
                <input :id="id" v-model="h.dockerSshKey" class="input font-mono" placeholder="/ssh/id_ed25519" spellcheck="false" />
              </Field>
              <Field v-slot="{ id }" label="Host key fingerprint" optional>
                <input :id="id" v-model="h.sshFingerprint" class="input font-mono" placeholder="SHA256:…" spellcheck="false" />
              </Field>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <Field v-slot="{ id }" label="Reverse proxy">
              <select :id="id" v-model="h.domainProvider" class="select">
                <option value="">Auto-detect / none</option>
                <option value="npm">Nginx Proxy Manager</option>
                <option value="nginx">Nginx (plain)</option>
                <option value="traefik">Traefik (labels)</option>
                <option value="traefik-file">Traefik (file)</option>
                <option value="caddy">Caddy</option>
              </select>
              </Field>
              <Field v-if="h.domainProvider === 'npm'" v-slot="{ id }" label="NPM proxy_host directory">
                <input :id="id" v-model="h.npmConfDir" class="input font-mono" placeholder="/npm/proxy_host" spellcheck="false" />
              </Field>
              <Field v-else-if="h.domainProvider === 'nginx'" v-slot="{ id }" label="Nginx config dir or file">
                <input :id="id" v-model="h.nginxConfDir" class="input font-mono" placeholder="/nginx/sites-enabled" spellcheck="false" />
              </Field>
              <Field v-else-if="h.domainProvider === 'traefik-file'" v-slot="{ id }" label="Traefik config file or dir">
                <input :id="id" v-model="h.traefikFilePath" class="input font-mono" placeholder="/traefik/dynamic" spellcheck="false" />
              </Field>
              <Field v-else-if="h.domainProvider === 'caddy'" v-slot="{ id }" label="Caddyfile path">
                <input :id="id" v-model="h.caddyfilePath" class="input font-mono" placeholder="/caddy/Caddyfile" spellcheck="false" />
              </Field>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-sm"
            @click="addHost"
          >
            + Add host
          </button>
        </div>
      </section>

      <!-- Reverse proxy -->
      <section v-show="inCategory('proxy')" :id="'proxy'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Reverse proxy (domain mapping)</h2>
        <p v-if="locked.domainProvider" class="text-xs text-slate-500">Set by <code>DOMAIN_PROVIDER</code> — locked.</p>
        <div class="space-y-3" :class="locked.domainProvider ? 'is-locked' : ''">
          <Field v-slot="{ id }" label="Provider" hint="Auto-detect uses whichever config path below is set, and falls back to Traefik container labels.">
          <select :id="id" v-model="form.domainProvider" class="select">
            <option value="">Auto-detect</option>
            <option value="npm">Nginx Proxy Manager</option>
            <option value="nginx">Nginx (plain)</option>
            <option value="traefik">Traefik (labels)</option>
            <option value="traefik-file">Traefik (file)</option>
            <option value="caddy">Caddy</option>
          </select>
          </Field>
          <Field v-if="form.domainProvider === 'npm' || (form.domainProvider === '' && form.npmConfDir)" v-slot="{ id }" label="NPM proxy_host directory" hint="The path inside the homeport container.">
            <input :id="id" v-model="form.npmConfDir" class="input font-mono" placeholder="/npm/proxy_host" spellcheck="false" />
          </Field>
          <Field v-if="form.domainProvider === 'nginx'" v-slot="{ id }" label="Nginx config dir or file">
            <input :id="id" v-model="form.nginxConfDir" class="input font-mono" placeholder="/nginx/sites-enabled" spellcheck="false" />
          </Field>
          <Field v-if="form.domainProvider === 'traefik-file'" v-slot="{ id }" label="Traefik dynamic config file or dir" hint="YAML or TOML.">
            <input :id="id" v-model="form.traefikFilePath" class="input font-mono" placeholder="/traefik/dynamic" spellcheck="false" />
          </Field>
          <Field v-if="form.domainProvider === 'caddy'" v-slot="{ id }" label="Caddyfile path" hint="The path inside the homeport container.">
            <input :id="id" v-model="form.caddyfilePath" class="input font-mono" placeholder="/caddy/Caddyfile" spellcheck="false" />
          </Field>
        </div>
        <TestButton label="Test provider" :run="testProvider" />
      </section>

      <!-- Proxy management (write side) -->
      <section v-show="inCategory('proxy-admin')" :id="'proxy-admin'"  v-if="form.allowProxyAdmin" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Proxy management</h2>
        <p class="text-xs text-slate-500">
          Credentials homeport uses to create/edit domains. Stored in <code>settings.json</code> on the
          data volume — set its file permissions accordingly.
        </p>

        <div v-if="form.domainProvider === 'npm' || form.domainProvider === ''" class="grid gap-3 sm:grid-cols-2">
          <p v-if="locked.npmApiUrl" class="text-xs text-slate-500 sm:col-span-2">Set by <code>HOMEPORT_NPM_API_URL</code>, locked.</p>
          <Field v-slot="{ id }" label="NPM API URL" class="sm:col-span-2">
            <input :id="id" v-model="form.npmApiUrl" class="input font-mono" placeholder="http://nginx-proxy-manager:81" spellcheck="false" />
          </Field>
          <Field v-slot="{ id }" label="NPM email">
            <input :id="id" v-model="form.npmApiIdentity" class="input" placeholder="admin@example.com" autocomplete="off" />
          </Field>
          <Field v-slot="{ id }" label="NPM password" :hint="npmApiSecretSet ? 'A password is stored; leave empty to keep it.' : undefined">
            <input :id="id" v-model="form.npmApiSecret" type="password" class="input" :placeholder="npmApiSecretSet ? '••••••' : ''" autocomplete="new-password" />
          </Field>
        </div>
        <Field v-if="form.domainProvider === 'caddy'" v-slot="{ id }" label="Caddy admin API" hint="The admin API controls the whole proxy: keep it on a private network, never published.">
          <input :id="id" v-model="form.caddyAdminUrl" class="input font-mono" placeholder="http://caddy:2019" spellcheck="false" />
        </Field>
        <p v-if="form.domainProvider === 'traefik-file'" class="text-[11px] text-slate-500">
          Traefik file admin writes a <code>homeport.yml</code> in the dynamic-config dir (or only
          <code>homeport-*</code> keys in a single file). Mount it <strong>read-write</strong>.
        </p>

        <div class="flex items-center gap-3">
          <button
            type="button"
            :disabled="proxyTesting"
            class="btn btn-sm"
            @click="testProxy"
          >{{ proxyTesting ? 'Testing…' : 'Test connection' }}</button>
          <span v-if="proxyMsg" class="text-[11px]" :class="proxyOk ? 'text-accent-light' : 'text-red-400'">{{ proxyMsg }}</span>
        </div>
      </section>

      <!-- Capabilities (tiered opt-in) -->
      <section v-show="inCategory('capabilities')" :id="'capabilities'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Capabilities</h2>
        <p class="text-xs text-slate-500">
          homeport is read-only by default. Each capability is its own opt-in; the hint shows what the
          docker-socket-proxy must allow for it.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            :disabled="probing"
            class="btn btn-sm"
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
            class="check"
          >
            <input v-model="(form as any)[c.key]" type="checkbox" :disabled="!!locked[c.lock]" />
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
                {{ c.hint }}<template v-if="locked[c.lock]"> · set by <code>{{ c.env }}</code>, locked</template>
              </span>
            </span>
          </label>
        </div>
      </section>

      <!-- Compose roots -->
      <section v-show="inCategory('stacks')" v-if="form.allowStacks" :id="'stacks'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Compose roots</h2>
        <p class="text-xs text-slate-500">
          Extra directories scanned for compose projects — each subfolder with a compose file becomes a fully
          manageable <NuxtLink to="/stacks" class="link">stack</NuxtLink>, edited and
          operated in place (nothing is copied). Mount each root into the homeport container at the
          <strong>same path it has on the host</strong> (e.g. <code class="text-slate-400">-v /home/user/docker:/home/user/docker</code>)
          so relative bind mounts keep pointing at the right host files.
          <template v-if="locked.composeRoots"> Set by <code>HOMEPORT_COMPOSE_ROOTS</code> — locked.</template>
        </p>
        <div class="space-y-2" :class="locked.composeRoots ? 'is-locked' : ''">
          <div v-for="(p, i) in form.composeRoots" :key="i" class="flex items-center gap-2">
            <input
              v-model="form.composeRoots[i]"
              class="input"
              placeholder="/home/user/docker"
            />
            <button
              type="button"
              class="btn shrink-0 text-slate-400 hover:!border-red-500/40 hover:!text-red-300"
              @click="form.composeRoots.splice(i, 1)"
            >Remove</button>
          </div>
          <button
            type="button"
            class="btn btn-sm"
            @click="form.composeRoots.push('')"
          >+ Add root</button>
        </div>
      </section>

      <!-- App catalog -->
      <section v-show="inCategory('catalog')" :id="'catalog'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">App catalog</h2>
        <p class="text-xs text-slate-500">
          Extra template sources for the <NuxtLink to="/catalog" class="link">catalog</NuxtLink>:
          homeport-native or Portainer <code>templates.json</code> URLs, fetched server-side.
          <template v-if="locked.catalogUrls"> Set by <code>HOMEPORT_CATALOG_URLS</code> — locked.</template>
        </p>
        <div class="space-y-2" :class="locked.catalogUrls ? 'is-locked' : ''">
          <div v-for="(u, i) in form.catalogUrls" :key="i" class="flex items-center gap-2">
            <input
              v-model="form.catalogUrls[i]"
              class="input"
              placeholder="https://raw.githubusercontent.com/…/templates.json"
            />
            <button
              type="button"
              class="btn shrink-0 text-slate-400 hover:!border-red-500/40 hover:!text-red-300"
              @click="form.catalogUrls.splice(i, 1)"
            >Remove</button>
          </div>
          <button
            type="button"
            class="btn btn-sm"
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
      <section v-show="inCategory('uptime')" :id="'uptime'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Uptime</h2>
        <p v-if="locked.pingEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_PING</code> — locked.</p>
        <label
          class="check"
          :class="locked.pingEnabled ? 'is-locked' : ''"
        >
          <input v-model="form.pingEnabled" type="checkbox" />
          HTTP-ping mapped domains
          <span class="text-[11px] text-slate-500">(up/down dot on each domain)</span>
        </label>
      </section>

      <!-- Host services -->
      <section v-show="inCategory('systemd')" :id="'systemd'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Host services</h2>
        <p v-if="locked.systemdEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_SYSTEMD</code> — locked.</p>
        <label
          class="check"
          :class="locked.systemdEnabled ? 'is-locked' : ''"
        >
          <input v-model="form.systemdEnabled" type="checkbox" />
          Show systemd services
          <span class="text-[11px] text-slate-500">(needs <code>systemctl</code> access — host install or mounted)</span>
        </label>
      </section>

      <!-- Monitoring -->
      <section v-show="inCategory('monitoring')" :id="'monitoring'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Monitoring</h2>
        <p v-if="locked.collectorInterval" class="text-xs text-slate-500">
          Interval set by <code>HOMEPORT_COLLECTOR_INTERVAL</code> — locked.
        </p>
        <label class="field-label">
          Background collector interval (seconds)
          <input
            v-model.number="form.collectorInterval"
            type="number"
            min="10"
            class="input" :class="['mt-1', locked.collectorInterval ? 'is-locked' : '']"
          />
          <span class="text-[11px] text-slate-500">
            How often homeport snapshots the fleet in the background to feed history and alerts. Minimum 10.
          </span>
        </label>
        <p v-if="locked.historyEnabled" class="text-xs text-slate-500">Set by <code>HOMEPORT_HISTORY</code> — locked.</p>
        <label
          class="check"
          :class="locked.historyEnabled ? 'is-locked' : ''"
        >
          <input v-model="form.historyEnabled" type="checkbox" />
          Keep CPU/RAM history
          <span class="text-[11px] text-slate-500">(graphs survive refresh/restart; stored under the data dir)</span>
        </label>
      </section>

      <!-- Alerts & notifications -->
      <section v-show="inCategory('alerts')" :id="'alerts'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Alerts &amp; notifications</h2>
        <p v-if="locked.alerts" class="text-xs text-slate-500">Set by <code>HOMEPORT_ALERTS</code> — locked.</p>
        <label
          class="check"
          :class="locked.alerts ? 'is-locked' : ''"
        >
          <input v-model="form.alertsEnabled" type="checkbox" />
          Notify on service state changes
        </label>

        <div v-if="form.alertsEnabled" class="space-y-4 border-l-2 border-white/[0.06] pl-4">
          <div class="flex flex-wrap gap-4 text-sm text-slate-300">
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.down" type="checkbox" /> Down</label>
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.unhealthy" type="checkbox" /> Unhealthy</label>
            <label class="flex items-center gap-1.5"><input v-model="form.alertTransitions.recovered" type="checkbox" /> Recovered</label>
          </div>

          <label class="check">
            <input v-model="form.alertUpdates" type="checkbox" />
            <span>
              Notify when image updates are found
              <span class="block text-[11px] text-slate-500">one message per new image digest, sent when the daily check (or “Check now”) discovers it — needs update checks enabled</span>
            </span>
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="field-label">
              Debounce (samples)
              <input v-model.number="form.alertDebounceSamples" type="number" min="1" class="input" :class="['mt-1']" />
            </label>
            <label class="field-label">
              Re-notify cooldown (seconds)
              <input v-model.number="form.alertCooldownSec" type="number" min="0" class="input" :class="['mt-1']" />
            </label>
          </div>

          <div class="space-y-3">
            <p class="text-xs text-slate-500">Webhook channels (Discord / Slack / ntfy / Apprise / custom). Add <code>hub.noalert=true</code> on a container to exclude it.</p>
            <div
              v-for="(ch, i) in form.alertChannels"
              :key="i"
              class="space-y-2 rounded-lg border border-white/[0.08] bg-ink-950/40 p-3"
            >
              <div class="flex items-end gap-2">
                <Field v-slot="{ id }" label="Name" class="flex-1">
                  <input :id="id" v-model="ch.name" class="input" placeholder="e.g. Discord #alerts" />
                </Field>
                <Field v-slot="{ id }" label="Type">
                <select :id="id" v-model="ch.preset" class="select w-36">
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="ntfy">ntfy</option>
                  <option value="apprise">Apprise</option>
                  <option value="custom">Custom</option>
                </select>
                </Field>
                <button
                  type="button"
                  class="btn btn-icon shrink-0 text-slate-400 hover:!border-red-500/40 hover:!text-red-300"
                  :aria-label="`Remove channel ${ch.name || i + 1}`"
                  title="Remove channel"
                  @click="form.alertChannels.splice(i, 1)"
                ><Icon name="trash" /></button>
              </div>
              <Field v-slot="{ id }" :label="ch.preset === 'apprise' ? 'Apprise API endpoint' : 'Webhook URL'">
                <input
                  :id="id"
                  v-model="ch.url"
                  class="input font-mono"
                  :placeholder="ch.preset === 'apprise' ? 'http://apprise:8000/notify/<key>' : 'https://…'"
                  spellcheck="false"
                />
              </Field>
              <Field v-if="ch.preset === 'apprise'" v-slot="{ id }" label="Apprise URLs" optional>
                <input :id="id" v-model="ch.urls" class="input font-mono" placeholder="pover://user@token, tgram://bot/chat" spellcheck="false" />
              </Field>
              <textarea
                v-if="ch.preset === 'custom'"
                v-model="ch.template"
                class="textarea font-mono text-xs"
                rows="2"
                placeholder='{"text":"{{text}}"}  — placeholders: {{name}} {{kind}} {{host}} {{from}} {{to}}'
              />
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="btn btn-sm"
                @click="addChannel"
              >
                + Add channel
              </button>
              <button
                type="button"
                :disabled="testing || (!form.alertChannels.length && !form.smtpHost)"
                class="btn btn-sm"
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
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field v-slot="{ id }" label="SMTP server">
                <input :id="id" v-model="form.smtpHost" class="input" placeholder="smtp.example.com" spellcheck="false" />
              </Field>
              <div class="flex items-end gap-3">
                <Field v-slot="{ id }" label="Port">
                  <input :id="id" v-model.number="form.smtpPort" type="number" min="1" max="65535" class="input w-28" placeholder="587" />
                </Field>
                <label class="check mb-2 text-xs text-slate-300">
                  <input v-model="form.smtpSecure" type="checkbox" /> TLS from the start (465)
                </label>
              </div>
              <Field v-slot="{ id }" label="Username" optional>
                <input :id="id" v-model="form.smtpUser" class="input" autocomplete="off" />
              </Field>
              <Field v-slot="{ id }" label="Password" optional :hint="smtpPassSet ? 'A password is stored; leave empty to keep it.' : undefined">
                <input :id="id" v-model="form.smtpPass" type="password" class="input" :placeholder="smtpPassSet ? '••••••' : ''" autocomplete="new-password" />
              </Field>
              <Field v-slot="{ id }" label="From">
                <input :id="id" v-model="form.smtpFrom" class="input" placeholder="homeport@example.com" />
              </Field>
              <Field v-slot="{ id }" label="To" hint="Separate several addresses with commas.">
                <input :id="id" v-model="form.smtpTo" class="input" placeholder="you@example.com" />
              </Field>
            </div>
          </div>
        </div>
      </section>

      <!-- Automatic updates -->
      <section v-show="inCategory('autoupdate')" :id="'autoupdate'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Automatic updates</h2>
        <p class="text-xs text-slate-500">
          Once a day, in the hour you pick, homeport applies pending image updates to everything opted in below.
          Managed stacks update via <code>compose pull &amp;&amp; up</code>; other containers are pulled and recreated in
          place. homeport itself is always skipped (use Settings → About → Update). Needs
          <em>Check for image updates</em> and <em>Apply image updates</em> enabled above. Results go to your alert channels.
        </p>
        <label class="check">
          <input v-model="form.autoUpdateEnabled" type="checkbox" />
          Apply updates automatically
        </label>
        <div v-if="form.autoUpdateEnabled" class="space-y-3 border-l-2 border-white/[0.06] pl-4">
          <label class="field-label">
            Daily window (server-local time)
            <select v-model.number="form.autoUpdateHour" class="select" :class="['mt-1 max-w-[10rem]']">
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
              <input v-model="form.autoUpdateTargets[i]" class="input" placeholder="stack/project or container name" />
              <button
                type="button"
                class="btn shrink-0 text-slate-400 hover:!border-red-500/40 hover:!text-red-300"
                @click="form.autoUpdateTargets.splice(i, 1)"
              >Remove</button>
            </div>
            <button
              type="button"
              class="btn btn-sm"
              @click="form.autoUpdateTargets.push('')"
            >+ Add target</button>
          </div>
        </div>
      </section>

      <!-- Registry credentials (private images) -->
      <section v-show="inCategory('registries')" v-if="form.updateCheckEnabled || form.allowUpdates" :id="'registries'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Registry credentials</h2>
        <p class="text-xs text-slate-500">
          Logins for checking and pulling <strong>private</strong> images (e.g. your own
          <code>ghcr.io</code> packages), used by update checks, container updates and stack
          <code>compose pull</code> alike. Without these, homeport talks to registries anonymously and private
          images fail with <code>unauthorized</code>. For GHCR use a token with <code>read:packages</code> (add
          <code>write:packages</code> only if you also apply updates). Stored in <code>settings.json</code> on the
          data volume — set its file permissions accordingly.
        </p>
        <p v-if="locked.registryCreds" class="text-xs text-slate-500">Set by <code>HOMEPORT_REGISTRY_AUTH</code> — locked.</p>
        <template v-else>
          <div v-for="(c, i) in form.registryCreds" :key="i" class="grid items-end gap-2 rounded-lg border border-white/[0.08] bg-ink-950/40 p-3 sm:grid-cols-[1fr_1fr_1.3fr_auto]">
            <Field v-slot="{ id }" label="Registry">
              <input :id="id" v-model="c.registry" class="input font-mono" placeholder="ghcr.io" spellcheck="false" />
            </Field>
            <Field v-slot="{ id }" label="Username">
              <input :id="id" v-model="c.username" class="input" autocomplete="off" />
            </Field>
            <Field v-slot="{ id }" label="Token or password">
              <input :id="id" v-model="c.token" type="password" class="input" :placeholder="c.tokenSet ? 'stored, empty keeps it' : ''" autocomplete="new-password" />
            </Field>
            <button
              type="button"
              class="btn btn-icon shrink-0 text-slate-400 hover:!border-red-500/40 hover:!text-red-300"
              :aria-label="`Remove ${c.registry || 'registry'} login`"
              title="Remove login"
              @click="form.registryCreds.splice(i, 1)"
            ><Icon name="trash" /></button>
          </div>
          <button
            type="button"
            class="btn btn-sm"
            @click="form.registryCreds.push({ registry: '', username: '', token: '' })"
          >+ Add registry login</button>
        </template>
      </section>

      <!-- Backup & restore -->
      <section v-show="inCategory('backup')" :id="'backup'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Backup</h2>
        <p class="text-xs text-slate-500">
          Everything homeport persists — settings, hosts, alert channels, proxy credentials, the admin password hash
          and stack git tokens — in one JSON file. <strong class="text-amber-300/90">It contains secrets; store it like a password.</strong>
          Compose files in the stacks directory aren't included (they live outside the data dir — keep those in git).
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm"
            @click="downloadBackup"
          >Download backup</button>
          <button
            type="button"
            class="btn btn-sm"
            @click="restoreInput?.click()"
          >Restore from file…</button>
          <input ref="restoreInput" type="file" accept="application/json,.json" class="hidden" @change="restoreBackup" />
          <span v-if="backupMsg" class="basis-full text-[11px]" :class="backupOk ? 'text-accent-light' : 'text-red-400'">{{ backupMsg }}</span>
        </div>
      </section>

      <!-- Appearance -->
      <section v-show="inCategory('appearance')" :id="'appearance'"  class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Appearance</h2>
        <p v-if="locked.remoteIcons" class="text-xs text-slate-500">Set by <code>HOMEPORT_REMOTE_ICONS</code> — locked.</p>
        <label
          class="check"
          :class="locked.remoteIcons ? 'is-locked' : ''"
        >
          <input v-model="form.remoteIcons" type="checkbox" />
          Fetch app logos from the dashboard-icons CDN
          <span class="text-[11px] text-slate-500">(off = offline monograms / your own icon URLs only)</span>
        </label>
      </section>

      <!-- Account -->
      <section v-show="inCategory('account')" :id="'account'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Account</h2>
        <p v-if="caps.passwordEnvLocked" class="text-xs text-slate-500">
          The admin password is set via <code>HOMEPORT_ADMIN_PASSWORD</code> — change it there.
        </p>
        <div v-else class="max-w-sm space-y-3">
          <Field v-slot="{ id }" label="Current password">
            <input :id="id" v-model="pw.current" type="password" class="input" autocomplete="current-password" />
          </Field>
          <Field v-slot="{ id }" label="New password">
            <input :id="id" v-model="pw.next" type="password" class="input" autocomplete="new-password" />
          </Field>
          <Field v-slot="{ id }" label="Confirm new password">
            <input :id="id" v-model="pw.confirm" type="password" class="input" autocomplete="new-password" />
          </Field>
          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="pwBusy"
              class="btn btn-sm"
              @click="changePassword"
            >{{ pwBusy ? 'Saving…' : 'Change password' }}</button>
            <span v-if="pwMsg" class="text-[11px]" :class="pwOk ? 'text-accent-light' : 'text-red-400'">{{ pwMsg }}</span>
          </div>
        </div>
      </section>

      <!-- Two-factor auth (self-contained enroll/disable flow, own endpoints) -->
      <section v-show="inCategory('two-factor')" :id="'two-factor'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">Two-factor auth</h2>
        <TwoFactorAuth />
      </section>

      <!-- User accounts (self-contained CRUD, own endpoints) -->
      <section v-show="inCategory('user-accounts')" :id="'user-accounts'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">User accounts</h2>
        <UserAccounts />
      </section>

      <!-- API tokens (self-contained CRUD, own endpoints) -->
      <section v-show="inCategory('api-tokens')" :id="'api-tokens'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">API tokens</h2>
        <ApiTokens />
      </section>

      <!-- About / self-update -->
      <section v-show="inCategory('about')" :id="'about'" class="card card-pad scroll-mt-8 space-y-3.5">
        <h2 class="text-[15px] font-semibold text-slate-100">About</h2>
        <p class="text-xs text-slate-500">
          homeport <b class="text-slate-300">v{{ appVersion || '…' }}</b>
          <span v-if="selfState.updateAvailable" class="badge badge-accent ml-1">update available</span>
          <template v-if="caps.demo"> · demo mode</template>
        </p>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="btn btn-sm"
            :class="selfState.updateAvailable ? 'btn-primary' : ''"
            :disabled="selfUpdating || !caps.updates && !caps.demo"
            @click="selfUpdate"
          ><Icon name="arrow-up" class="h-3.5 w-3.5" /> {{ selfState.updateAvailable ? 'Update homeport now' : 'Update homeport' }}</button>
          <span v-if="!caps.updates && !caps.demo" class="text-[11px] text-slate-500">needs the “Apply image updates” capability</span>
          <span v-if="selfUpdateMsg" class="text-[11px]" :class="selfUpdateOk ? 'text-accent-light' : 'text-red-400'">{{ selfUpdateMsg }}</span>
        </div>
        <p class="text-[11px] text-slate-600">
          Pulls the newest image and recreates this container from outside (a short-lived helper
          runs <code>compose pull && up -d</code>). The UI reconnects automatically.
        </p>
      </section>

      <!-- appears as soon as something changes; the security section saves per action -->
      <Transition name="savebar">
        <div
          v-if="category !== 'security' && (dirty || (msg && !msgOk))"
          class="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-ink-900/95 px-4 py-3 backdrop-blur-md"
          style="box-shadow: var(--shadow-pop)"
        >
          <span class="flex items-center gap-2 text-[13px] text-slate-100">
            <span class="dot bg-amber-400" />
            {{ dirty ? 'You have unsaved changes' : 'Could not save' }}
          </span>
          <span v-if="msg && !msgOk" class="text-xs text-red-400">{{ msg }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button v-if="dirty" type="button" class="btn btn-ghost" :disabled="busy" @click="discard">Discard</button>
            <button type="submit" :disabled="busy || !writable || !dirty" class="btn btn-primary">{{ busy ? 'Saving…' : 'Save changes' }}</button>
          </div>
        </div>
      </Transition>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">

const loaded = ref(false)
const writable = ref(true)
const npmApiSecretSet = ref(false) // a secret is stored server-side (masked); blank on save = keep
const smtpPassSet = ref(false)
const locked = ref<Record<string, boolean>>({})
const busy = ref(false)
const msg = ref('')
const msgOk = ref(false)

// Sections are grouped into categories, one shown at a time. `?tab=` holds the
// category and an old-style `#section` anchor still lands on the right one.
const CATEGORY_OF: Record<string, string> = {
  docker: 'connection',
  hosts: 'connection',
  proxy: 'proxy',
  'proxy-admin': 'proxy',
  capabilities: 'capabilities',
  stacks: 'capabilities',
  catalog: 'capabilities',
  systemd: 'capabilities',
  uptime: 'monitoring',
  monitoring: 'monitoring',
  alerts: 'monitoring',
  autoupdate: 'updates',
  registries: 'updates',
  account: 'security',
  'two-factor': 'security',
  'user-accounts': 'security',
  'api-tokens': 'security',
  appearance: 'system',
  backup: 'system',
  about: 'system',
}
const categories = [
  { id: 'connection', label: 'Docker & hosts', icon: 'server' },
  { id: 'proxy', label: 'Reverse proxy', icon: 'globe' },
  { id: 'capabilities', label: 'Capabilities', icon: 'sliders' },
  { id: 'monitoring', label: 'Monitoring & alerts', icon: 'bell' },
  { id: 'updates', label: 'Updates', icon: 'arrow-up' },
  { id: 'security', label: 'Security & users', icon: 'shield' },
  { id: 'system', label: 'Backup & about', icon: 'info' },
]
const route = useRoute()
const router = useRouter()
const category = ref(
  categories.some((c) => c.id === route.query.tab) ? String(route.query.tab) : CATEGORY_OF[route.hash.slice(1)] ?? 'connection',
)
watch(category, (c) => {
  router.replace({ query: { ...route.query, tab: c === 'connection' ? undefined : c }, hash: '' })
  if (import.meta.client) window.scrollTo({ top: 0 })
})
const inCategory = (sectionId: string) => CATEGORY_OF[sectionId] === category.value
onMounted(() => {
  const anchor = route.hash.slice(1)
  if (anchor && CATEGORY_OF[anchor]) nextTick(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }))
})
const active = ref('docker')
const sections = computed(() =>
  [
    { id: 'docker', label: 'Docker connection' },
    { id: 'hosts', label: 'Hosts' },
    { id: 'proxy', label: 'Reverse proxy' },
    ...(form.allowProxyAdmin ? [{ id: 'proxy-admin', label: 'Proxy management' }] : []),
    { id: 'capabilities', label: 'Capabilities' },
    ...(form.allowStacks ? [{ id: 'stacks', label: 'Compose roots' }] : []),
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
    { id: 'two-factor', label: 'Two-factor auth' },
    { id: 'user-accounts', label: 'User accounts' },
    { id: 'api-tokens', label: 'API tokens' },
    { id: 'about', label: 'About' },
  ],
)

const { caps, load: loadCaps } = useCapabilities()
const { confirm } = useConfirm()

// --- about / self-update --- (shared flow lives in useSelfUpdate so the sidebar
// indicator and this page stay in sync)
const { state: selfState, refresh: refreshSelfUpdate, run: selfUpdate, busy: selfUpdating, msg: selfUpdateMsg, ok: selfUpdateOk } = useSelfUpdate()
const appVersion = computed(() => selfState.value.version)

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

// Ask the server what is actually mapping domains: auto-detect can find a
// provider (e.g. Traefik labels) with none of the path fields filled in.
const { data: svcData, refresh: refreshServices } = useServices()
const detectedProvider = computed(() => svcData.value?.domainProvider ?? null)
const showProviderHint = computed(() => loaded.value && !!svcData.value && !detectedProvider.value && !caps.value.demo)

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
  composeRoots: [] as string[],
  catalogUrls: [] as string[],
  allowTerminal: false,
  allowContainerFiles: false,
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
  { key: 'allowContainerFiles', lock: 'allowContainerFiles', env: 'HOMEPORT_ALLOW_CONTAINER_FILES', label: 'Browse + edit files inside containers/volumes', hint: 'reads/writes container files via docker cp — needs CONTAINERS=1 + PUT allowed on the socket proxy' },
  { key: 'allowProxyAdmin', lock: 'allowProxyAdmin', env: 'HOMEPORT_ALLOW_PROXY_ADMIN', label: 'Manage the reverse proxy (domains)', hint: 'talks to your proxy, not Docker — needs provider credentials below' },
] as const

interface ChannelRow {
  name: string
  url: string
  preset: 'discord' | 'slack' | 'ntfy' | 'apprise' | 'custom'
  template?: string
  urls?: string
}

interface RegistryCredRow {
  registry: string
  username: string
  token: string
  tokenSet?: boolean // a token is stored (masked); blank on save = keep it
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
  allowContainerFiles: 'containerFiles',
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
  if (!(await confirm({
    title: 'Restore backup?',
    message: `Replace ALL settings with the backup from ${when}?${parsed.demo ? '\n(Note: this backup was exported from a demo instance.)' : ''}`,
    detail: 'If it includes a different admin password/session secret, you will be logged out.',
    confirmLabel: 'Restore',
    danger: true,
  }))) return
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
  if (!svcData.value) refreshServices() // for the "no reverse proxy" hint
  loadCaps()
  refreshSelfUpdate()
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
      tokenSet: !!c.tokenSet,
    }))
    locked.value = r.locked
    writable.value = r.writable
    npmApiSecretSet.value = !!r.settings.npmApiSecretSet
    smtpPassSet.value = !!r.settings.smtpPassSet
  } catch (e: any) {
    if ((e?.statusCode ?? e?.response?.status) === 401) return navigateTo('/login')
  } finally {
    loaded.value = true
  }
})

// Unsaved-change tracking: a snapshot of the form as last loaded/saved.
const snapshot = ref('')
const dirty = computed(() => loaded.value && !!snapshot.value && JSON.stringify(form) !== snapshot.value)
watch(loaded, (l) => {
  if (l) nextTick(() => (snapshot.value = JSON.stringify(form)))
})
function discard() {
  if (snapshot.value) Object.assign(form, JSON.parse(snapshot.value))
  msg.value = ''
}
useUnsavedGuard(() => dirty.value, 'Your settings changes have not been saved.')

const toast = useToast()
async function save() {
  busy.value = true
  msg.value = ''
  try {
    await $fetch('/api/settings', { method: 'POST', body: { ...form } })
    snapshot.value = JSON.stringify(form)
    msgOk.value = true
    msg.value = 'Saved.'
    toast.success('Settings saved')
  } catch (e: any) {
    msgOk.value = false
    msg.value = errMsg(e, 'Save failed')
  } finally {
    busy.value = false
  }
}

useHead({ title: 'Settings · homeport' })
</script>

<style scoped>
.savebar-enter-active,
.savebar-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.savebar-enter-from,
.savebar-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
