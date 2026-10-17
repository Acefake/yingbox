import { describe, expect, it } from 'vitest'
import { configPatch, type Config, type Schema } from '../src/renderer/src/views/Amane/config-schema'

describe('Amane settings patches', () => {
  const schema: Schema = { properties: {
    sr: { properties: { enabled: { type: 'boolean' } } },
    watermark: { properties: { enabled: { type: 'boolean' }, scale: { type: 'number' } } },
    network: { properties: { proxy: { anyOf: [{ type: 'string' }, { type: 'null' }] } } },
  } }
  const baseline: Config = { sr: { enabled: false }, watermark: { enabled: false, scale: 0.08 }, network: { proxy: null } }

  it('saves changes across groups together without sending unchanged fields', () => {
    const draft = { ...baseline, sr: { enabled: true }, watermark: { ...baseline.watermark, enabled: true } }
    expect(configPatch(draft, baseline, schema)).toEqual({ sr: { enabled: true }, watermark: { enabled: true } })
    expect(baseline.sr.enabled).toBe(false)
  })
  it('preserves false and zero values and encodes nullable fields', () => {
    expect(configPatch({ sr: { enabled: false }, watermark: { scale: 0 }, network: { proxy: '' } },
      { sr: { enabled: true }, watermark: { scale: 0.08 }, network: { proxy: 'http://localhost:8080' } }, schema))
      .toEqual({ sr: { enabled: false }, watermark: { scale: 0 }, network: { proxy: null } })
  })
  it('does not send a patch for unchanged settings', () => {
    expect(configPatch(baseline, baseline, schema)).toEqual({})
  })
})
