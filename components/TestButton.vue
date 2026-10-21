<template>
  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      :disabled="busy"
      class="btn btn-sm"
      @click="run"
    >{{ busy ? 'Testing…' : label }}</button>
    <span v-if="msg" class="inline-flex items-center gap-1.5 text-xs" :class="ok ? 'text-ok' : 'text-red-400'"><Icon :name="ok ? 'check' : 'alert'" class="h-3.5 w-3.5 shrink-0" />{{ msg }}</span>
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
    msg.value = errMsg(e, 'Test failed')
  } finally {
    busy.value = false
  }
}
</script>
