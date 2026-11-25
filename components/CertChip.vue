<template>
  <span
    v-if="c"
    class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px]"
    :class="tone"
    :title="title"
  ><Icon :name="c.trusted ? 'lock' : 'alert'" class="h-3 w-3" />{{ label }}</span>
</template>

<script setup lang="ts">
// The certificate a domain serves: quiet while it is fine, coloured when it needs a
// look. Colour follows the level, not the presence of a certificate.
const props = defineProps<{ url: string }>()
const { certs } = useCerts()
const c = computed(() => certs.value[props.url] ?? null)

const label = computed(() => {
  const x = c.value!
  if (!x.trusted && x.error !== 'CERT_HAS_EXPIRED') return `cert ${certErrorText(x.error)}`
  if (x.level === 'ok') return `cert ${Math.max(0, Math.floor((x.notAfter - Date.now()) / 86_400_000))} d`
  return `cert ${x.left}`
})
const tone = computed(() => {
  const x = c.value!
  if (x.level === 'expired' || x.level === 'critical') return 'text-red-300'
  if (x.level === 'warn' || !x.trusted) return 'text-amber-300'
  return 'text-slate-500'
})
const title = computed(() => {
  const x = c.value!
  const lines = [
    `Certificate ${x.left}, until ${new Date(x.notAfter).toLocaleString()}`,
    x.issuer ? `Issued by ${x.issuer}` : '',
    x.names.length ? `Covers ${x.names.slice(0, 6).join(', ')}${x.names.length > 6 ? ` and ${x.names.length - 6} more` : ''}` : '',
    x.trusted ? 'Trusted by browsers' : `Not trusted: ${certErrorText(x.error)} (${x.error})`,
    `Checked ${new Date(x.checkedAt).toLocaleString()}${x.failed ? `, last check failed: ${x.failed}` : ''}`,
  ]
  return lines.filter(Boolean).join('\n')
})
</script>
