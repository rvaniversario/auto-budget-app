import { describe, expect, it } from 'vitest'
import { APP_VERSION, RELEASES } from './releases'

describe('releases', () => {
  it('the newest release note matches the version in package.json', () => {
    expect(RELEASES[0].version).toBe(APP_VERSION)
  })

  it('every release has a semantic version, a date and highlights, newest first', () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.highlights.length).toBeGreaterThan(0)
    }
    const dates = RELEASES.map((r) => r.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    expect(new Set(RELEASES.map((r) => r.version)).size).toBe(RELEASES.length)
  })
})
