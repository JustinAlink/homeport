<template>
  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      :disabled="busy"
      class="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
      @click="run"
    >{{ busy ? 'Testing…' : label }}</button>
    <span v-if="msg" class="text-[11px]" :class="ok ? 'text-accent-light' : 'text-red-400'">{{ msg }}</span>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{ label?: string; run: () => Promise<{ ok: boolean; message: string }> }>(),
  { label: 'Test connection' },
)

const busy = ref(false)
const ok = ref(false)
const msg = ref('')

async function run() {
  busy.value = true
  msg.value = ''
  try {
    const r = await props.run()
    ok.value = r.ok
    msg.value = r.message
  } catch (e: any) {
    ok.value = false
    msg.value = e?.statusMessage || e?.message || 'Test failed'
  } finally {
    busy.value = false
  }
}
</script>
