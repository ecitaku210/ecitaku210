import { describe, expect, it } from 'vitest'
import { computeSplit, equalParts, PERCENT_TOTAL } from './split'
import { MAX_MINOR } from './money'
import { rng } from './testkit'

function shares(result: ReturnType<typeof computeSplit>) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.message}`)
  return result.shares
}
function sum(map: Map<string, number>) {
  return [...map.values()].reduce((a, b) => a + b, 0)
}

describe('computeSplit — the sum invariant', () => {
  it('splits an indivisible amount without losing or inventing a paisa', () => {
    // ₹100.00 three ways is the canonical case: 33.33 x 3 = 99.99.
    const s = shares(computeSplit(10_000, 'equal', equalParts(['a', 'b', 'c'])))
    expect(sum(s)).toBe(10_000)
    expect([...s.values()].sort()).toEqual([3333, 3333, 3334])
  })

  it('holds across thousands of awkward amounts and group sizes', () => {
    const rand = rng(99)
    for (let i = 0; i < 5000; i += 1) {
      const n = 1 + Math.floor(rand() * 9)
      const amount = 1 + Math.floor(rand() * 1_000_000)
      const ids = Array.from({ length: n }, (_, k) => `m${k}`)
      const s = shares(computeSplit(amount, 'equal', equalParts(ids)))
      expect(sum(s)).toBe(amount)
    }
  })

  it('never hands anyone more than one extra minor unit', () => {
    const s = shares(computeSplit(10_001, 'equal', equalParts(['a', 'b', 'c', 'd', 'e', 'f', 'g'])))
    const values = [...s.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
    expect(sum(s)).toBe(10_001)
  })
})

describe('computeSplit — determinism across replicas', () => {
  it('gives the same answer regardless of the order parts arrive in', () => {
    const parts = equalParts(['zed', 'amy', 'bob', 'kim'])
    const forward = shares(computeSplit(1000, 'equal', parts))
    const backward = shares(computeSplit(1000, 'equal', [...parts].reverse()))
    for (const [k, v] of forward) expect(backward.get(k)).toBe(v)
  })

  it('breaks rounding ties on member id, not insertion order', () => {
    // 10 paise between 3 people: exactly one leftover unit, and all three
    // remainders are equal, so only the id tie-break decides who gets it.
    const a = shares(computeSplit(10, 'equal', equalParts(['c', 'a', 'b'])))
    const b = shares(computeSplit(10, 'equal', equalParts(['b', 'c', 'a'])))
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
    expect(a.get('a')).toBe(4) // lowest id wins the leftover
  })
})

describe('computeSplit — shares mode', () => {
  it('weights a couple sharing one room as two shares', () => {
    const s = shares(
      computeSplit(30_000, 'shares', [
        { memberId: 'solo', weight: 1 },
        { memberId: 'couple', weight: 2 },
      ]),
    )
    expect(s.get('solo')).toBe(10_000)
    expect(s.get('couple')).toBe(20_000)
  })

  it('lets a weight of zero excuse someone without dropping them', () => {
    const s = shares(
      computeSplit(999, 'shares', [
        { memberId: 'a', weight: 1 },
        { memberId: 'b', weight: 1 },
        { memberId: 'teetotal', weight: 0 },
      ]),
    )
    expect(s.get('teetotal')).toBe(0)
    expect(sum(s)).toBe(999)
  })

  it('rejects an all-zero split rather than dividing by zero', () => {
    const r = computeSplit(100, 'shares', [
      { memberId: 'a', weight: 0 },
      { memberId: 'b', weight: 0 },
    ])
    expect(r.ok).toBe(false)
  })
})

describe('computeSplit — percent mode', () => {
  it('accepts basis points that total exactly 100%', () => {
    const s = shares(
      computeSplit(12_345, 'percent', [
        { memberId: 'a', weight: 3333 },
        { memberId: 'b', weight: 6667 },
      ]),
    )
    expect(sum(s)).toBe(12_345)
  })

  it('refuses percentages that do not add to 100', () => {
    const r = computeSplit(1000, 'percent', [
      { memberId: 'a', weight: 5000 },
      { memberId: 'b', weight: 4000 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('100%')
  })

  it('uses basis points so 33.33% is representable', () => {
    expect(PERCENT_TOTAL).toBe(10_000)
  })
})

describe('computeSplit — exact mode', () => {
  it('passes the given amounts straight through', () => {
    const s = shares(
      computeSplit(5000, 'exact', [
        { memberId: 'a', weight: 1500 },
        { memberId: 'b', weight: 3500 },
      ]),
    )
    expect(s.get('a')).toBe(1500)
    expect(s.get('b')).toBe(3500)
  })

  it('refuses amounts that do not reconcile to the total', () => {
    const r = computeSplit(5000, 'exact', [
      { memberId: 'a', weight: 1500 },
      { memberId: 'b', weight: 3000 },
    ])
    expect(r.ok).toBe(false)
  })
})

describe('computeSplit — rejections', () => {
  it.each([
    ['zero amount', 0, 'equal', equalParts(['a'])],
    ['negative amount', -100, 'equal', equalParts(['a'])],
    ['fractional amount', 10.5, 'equal', equalParts(['a'])],
    ['nobody in the split', 100, 'equal', []],
    ['fractional share weight', 100, 'shares', [{ memberId: 'a', weight: 1.5 }]],
    ['negative share weight', 100, 'shares', [{ memberId: 'a', weight: -1 }]],
  ] as const)('rejects %s', (_label, amount, mode, parts) => {
    expect(computeSplit(amount, mode, [...parts]).ok).toBe(false)
  })

  it('rejects the same person listed twice', () => {
    const r = computeSplit(100, 'equal', [
      { memberId: 'a', weight: 1 },
      { memberId: 'a', weight: 1 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('twice')
  })
})

describe('computeSplit — precision limits', () => {
  it('refuses weights so large that the multiply leaves the exact-integer range', () => {
    // amount * totalWeight here is ~9e21, far past 2^53. The sum would still
    // come out right (the leftover pass hides it), but individual shares drift:
    // two members whose weights differ by 1 in 9 billion ended up 55 minor
    // units apart. Silently unfair is worse than refused.
    const r = computeSplit(MAX_MINOR, 'shares', [
      { memberId: 'a', weight: 90_000_000_000 },
      { memberId: 'b', weight: 90_000_000_001 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('too large')
  })

  it('still accepts the largest realistic trip', () => {
    // 100 million major units, 20 people on 5 shares each.
    const parts = Array.from({ length: 20 }, (_, i) => ({ memberId: `m${i}`, weight: 5 }))
    const r = computeSplit(10_000_000_000, 'shares', parts)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect([...r.shares.values()].reduce((a, b) => a + b, 0)).toBe(10_000_000_000)
    }
  })

  it('accepts a percentage split at the largest amount the app allows', () => {
    // MAX_MINOR is chosen so that MAX_MINOR * 10_000 basis points stays inside
    // the exact-integer range. If someone raises one without the other, this
    // is the test that catches it.
    const r = computeSplit(MAX_MINOR, 'percent', [
      { memberId: 'a', weight: 3333 },
      { memberId: 'b', weight: 6667 },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect([...r.shares.values()].reduce((a, b) => a + b, 0)).toBe(MAX_MINOR)
  })

  it('refuses an amount above the supported maximum', () => {
    const r = computeSplit(MAX_MINOR + 1, 'equal', equalParts(['a', 'b']))
    expect(r.ok).toBe(false)
  })
})
