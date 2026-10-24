import { test } from 'node:test'
import assert from 'node:assert/strict'
import { niceScaleMax } from '../utils/chartScale.ts'

test('the usage chart fits its scale to the data, on round steps, never past the cap', () => {
  assert.equal(niceScaleMax(0.6), 5) // a quiet big server
  assert.equal(niceScaleMax(4.9), 10)
  assert.equal(niceScaleMax(17), 25)
  assert.equal(niceScaleMax(70), 100)
  assert.equal(niceScaleMax(99), 100)
  assert.equal(niceScaleMax(140), 100) // CPU over 100% (several cores) still caps
  assert.equal(niceScaleMax(0), 5)
})
