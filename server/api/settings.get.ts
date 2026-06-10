import { getEnvLocks, getSettingsView } from '../utils/config'
import { settingsWritable } from '../utils/settings'

export default defineEventHandler(() => ({
  settings: getSettingsView(),
  locked: getEnvLocks(),
  writable: settingsWritable(),
}))
