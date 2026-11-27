<template>
  <div class="space-y-4">
    <p class="text-[13px] leading-relaxed text-slate-400">
      Sign in through your identity provider (Authentik, Authelia, Keycloak, Pocket ID, Zitadel, any OpenID Connect provider).
      Who gets in, and as what, follows the provider's groups. The admin password keeps working.
    </p>

    <label class="check" :class="locked.oidc ? 'is-locked' : ''">
      <input v-model="form.oidcEnabled" type="checkbox" :disabled="locked.oidc" />
      <span>Offer single sign-on on the login page<span v-if="locked.oidc" class="block text-[11px] text-slate-500">set by <code>HOMEPORT_OIDC</code></span></span>
    </label>

    <div class="grid gap-3 sm:grid-cols-2">
      <Field v-slot="{ id }" label="homeport's public URL" :hint="locked.publicUrl ? 'Set by HOMEPORT_PUBLIC_URL.' : 'The address you open homeport at. The redirect URI is built from it.'">
        <input :id="id" v-model="form.publicUrl" class="input" :class="locked.publicUrl ? 'is-locked' : ''" :disabled="locked.publicUrl" placeholder="https://hub.example.com" spellcheck="false" />
      </Field>
      <div>
        <p class="field-label">Redirect URI <span class="font-normal text-slate-500">(paste into the provider)</span></p>
        <div v-if="redirect" class="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/50 px-2.5 py-1.5">
          <code class="min-w-0 flex-1 truncate text-[12px] text-slate-200">{{ redirect }}</code>
          <CopyButton :text="redirect" label="redirect URI" />
        </div>
        <p v-else class="field-hint mt-1.5">Fill in the public URL first.</p>
      </div>
      <Field v-slot="{ id }" label="Issuer URL" :hint="locked.oidcIssuer ? 'Set by HOMEPORT_OIDC_ISSUER.' : 'Where /.well-known/openid-configuration lives. Authentik: keep the trailing slash.'">
        <input :id="id" v-model="form.oidcIssuer" class="input" :class="locked.oidcIssuer ? 'is-locked' : ''" :disabled="locked.oidcIssuer" placeholder="https://auth.example.com/application/o/homeport/" spellcheck="false" />
      </Field>
      <Field v-slot="{ id }" label="Client ID" :hint="locked.oidcClientId ? 'Set by HOMEPORT_OIDC_CLIENT_ID.' : undefined">
        <input :id="id" v-model="form.oidcClientId" class="input" :class="locked.oidcClientId ? 'is-locked' : ''" :disabled="locked.oidcClientId" spellcheck="false" />
      </Field>
      <Field v-slot="{ id }" label="Client secret" :hint="locked.oidcClientSecret ? 'Set by HOMEPORT_OIDC_CLIENT_SECRET.' : secretSet ? 'Stored. Leave blank to keep it.' : undefined">
        <input :id="id" v-model="form.oidcClientSecret" type="password" autocomplete="new-password" class="input" :disabled="locked.oidcClientSecret" :placeholder="secretSet ? '••••••••' : ''" />
      </Field>
      <Field v-slot="{ id }" label="Scopes" hint="openid is always included. Scopes the provider doesn't offer are left out.">
        <input :id="id" v-model="form.oidcScopes" class="input" spellcheck="false" />
      </Field>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="btn btn-sm" :disabled="testing || !form.oidcIssuer" @click="test"><Icon name="refresh" :class="testing ? 'animate-spin' : ''" /> {{ testing ? 'Testing…' : 'Test the provider' }}</button>
      <span v-if="result" class="text-[12px]" :class="result.ok ? 'text-ok' : 'text-red-300'" role="status">{{ result.message }}</span>
      <span v-if="/^http:/i.test(form.oidcIssuer || '')" class="text-[12px] text-amber-300">An http:// issuer sends tokens unencrypted: only on a network you trust.</span>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <Field v-slot="{ id }" label="Groups claim" hint="A dotted path is fine, e.g. resource_access.homeport.roles.">
        <input :id="id" v-model="form.oidcGroupsClaim" class="input font-mono" spellcheck="false" />
      </Field>
      <Field v-slot="{ id }" label="Admin groups" hint="Comma separated. Full control.">
        <input :id="id" v-model="adminText" class="input" placeholder="homeport-admins" spellcheck="false" />
      </Field>
      <Field v-slot="{ id }" label="Viewer groups" hint="Comma separated. Read-only.">
        <input :id="id" v-model="viewerText" class="input" placeholder="family, friends" spellcheck="false" />
      </Field>
    </div>
    <p class="callout callout-info text-xs">
      <Icon name="info" />
      <span>Someone in none of these groups is turned away, even though the provider let them sign in. Viewer accounts are created on their first sign-in (listed under User accounts) and matched by the provider's account id, never by email.</span>
    </p>

    <div class="grid gap-3 sm:grid-cols-3">
      <Field v-slot="{ id }" label="Button label" optional>
        <input :id="id" v-model="form.oidcButtonLabel" class="input" maxlength="40" placeholder="Sign in with SSO" />
      </Field>
      <label class="check sm:col-span-2 sm:self-end">
        <input v-model="form.oidcAutoRedirect" type="checkbox" />
        <span>Go straight to the provider<span class="block text-[11px] text-slate-500">skips the login page; never after a logout or a failed attempt</span></span>
      </label>
    </div>
    <label class="check">
      <input v-model="form.oidcHidePassword" type="checkbox" />
      <span>Hide the password form<span class="block text-[11px] text-slate-500"><code>/login?local=1</code> always shows it, so a broken provider can't lock you out</span></span>
    </label>

    <details class="text-[12.5px] text-slate-400">
      <summary class="cursor-pointer text-slate-300">Where each provider puts the groups</summary>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li><span class="text-slate-200">Authentik:</span> <code>groups</code>, sent with the <code>profile</code> scope. Select a signing key on the provider: tokens signed with the client secret are not accepted.</li>
        <li><span class="text-slate-200">Authelia:</span> add the <code>groups</code> scope to the client; the groups come from userinfo, which homeport reads.</li>
        <li><span class="text-slate-200">Keycloak:</span> add a Group Membership mapper with claim <code>groups</code> (to the ID token or userinfo). Keycloak has no <code>groups</code> scope; homeport leaves it out of the request by itself. A leading <code>/</code> from "Full group path" is ignored.</li>
        <li><span class="text-slate-200">Pocket ID:</span> the <code>groups</code> scope.</li>
        <li><span class="text-slate-200">Zitadel:</span> claim <code>urn:zitadel:iam:org:project:roles</code>, with "Assert Roles on Authentication" on.</li>
      </ul>
    </details>
  </div>
</template>

<script setup lang="ts">
// Single sign-on settings: fields of the settings form, saved with the page.
const props = defineProps<{ form: Record<string, any>; locked: Record<string, boolean>; secretSet: boolean }>()

const redirect = computed(() => {
  try {
    const u = new URL(String(props.form.publicUrl || '').trim())
    return /^https?:$/.test(u.protocol) ? `${u.origin}/api/auth/oidc/callback` : ''
  } catch {
    return ''
  }
})
// groups arrive as arrays and are edited as text; the server parses either
const listText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))
const adminText = computed({ get: () => listText(props.form.oidcAdminGroups), set: (v: string) => (props.form.oidcAdminGroups = v) })
const viewerText = computed({ get: () => listText(props.form.oidcViewerGroups), set: (v: string) => (props.form.oidcViewerGroups = v) })

const testing = ref(false)
const result = ref<{ ok: boolean; message: string } | null>(null)
async function test() {
  testing.value = true
  result.value = null
  try {
    result.value = await $fetch('/api/auth/oidc/test', {
      method: 'POST',
      body: { issuer: props.form.oidcIssuer, clientId: props.form.oidcClientId, clientSecret: props.form.oidcClientSecret || undefined, scopes: props.form.oidcScopes },
    })
  } catch (e: any) {
    result.value = { ok: false, message: errMsg(e, 'Test failed') }
  } finally {
    testing.value = false
  }
}
</script>
