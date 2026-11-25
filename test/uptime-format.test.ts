import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatUptime, formatDuration, uptimeTone } from '../utils/uptime.ts'

test('uptime never rounds a real outage up to 100%', () => {
  assert.equal(formatUptime(1), '100%')
  assert.equal(formatUptime(0.99999), '99.99%') // a minute down in a week
  assert.equal(formatUptime(0.9983), '99.83%')
  assert.equal(formatUptime(0.995), '99.5%')
  assert.equal(formatUptime(0.9), '90%')
  assert.equal(formatUptime(0.0417), '4.1%')
  assert.equal(formatUptime(0), '0%')
  assert.equal(formatUptime(null), 'No data')
})

test('downtime reads in the largest sensible units', () => {
  assert.equal(formatDuration(20_000), 'under a minute')
  assert.equal(formatDuration(40 * 60_000), '40 min')
  assert.equal(formatDuration(185 * 60_000), '3 h 5 min')
  assert.equal(formatDuration(3 * 3600_000), '3 h')
  assert.equal(formatDuration(52 * 3600_000), '2 d 4 h')
})

test('day tones: fully up, some downtime, a real outage, no data', () => {
  assert.equal(uptimeTone(1), 'ok')
  assert.equal(uptimeTone(0.9996), 'ok') // under a minute in a day
  assert.equal(uptimeTone(0.97), 'warn')
  assert.equal(uptimeTone(0.5), 'bad')
  assert.equal(uptimeTone(null), 'none')
})
