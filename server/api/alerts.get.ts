import { recentAlerts, alertsPersistent } from '../utils/alerts'

// Recent alert events for the in-app log. Auth-protected by the global middleware.
export default defineEventHandler(() => ({
  alerts: recentAlerts(100),
  persistent: alertsPersistent(),
}))
