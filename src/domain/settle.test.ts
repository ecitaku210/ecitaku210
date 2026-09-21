import { describe, expect, it } from 'vitest'
import { computeTotals } from './balance'
import { settlementPlan } from './settle'
import { randomTrip } from './testkit'
import type { MemberBalance } from './balance'

function bal(memberId: string, netMinor: number): MemberBalance {
  return {
    memberId,
    paidMinor: 0,
    owedMinor: 0,
    settledOutMinor: 0,
    settledInMinor: 0,
    netMinor,
  }
}

/** Applying the plan must leave everyone at exactly zero. */
function applyPlan(balances: MemberBalance[]) {
  const after = new Map(balances.map((b) => [b.memberId, b.netMinor]))
  for (const t of settlementPlan(balances.map((b) => ({ ...b })))) {
    after.set(t.fromMember, (after.get(t.fromMember) ?? 0) + t.amountMinor)
    after.set(t.toMember, (after.get(t.toMember) ?? 0) - t.amountMinor)
  }
  return [...after.values()]
}

describe('settlementPlan', () => {
  it('settles the textbook case in one transfer', () => {
    const plan = settlementPlan([bal('a', 10_000), bal('b', -10_000)])
    expect(plan).toEqual([{ fromMember: 'b', toMember: 'a', amountMinor: 10_000 }])
  })

  it('clears everyone to zero on 200 random ledgers', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const balances = computeTotals(randomTrip(seed)).balances
      expect(applyPlan(balances).every((v) => v === 0)).toBe(true)
    }
  })

  it('needs at most n-1 transfers', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const balances = computeTotals(randomTrip(seed, 8, 60)).balances
      const involved = balances.filter((b) => b.netMinor !== 0).length
      const plan = settlementPlan(balances.map((b) => ({ ...b })))
      if (involved > 0) expect(plan.length).toBeLessThanOrEqual(involved - 1)
    }
  })

  it('produces no transfers when the group is already square', () => {
    expect(settlementPlan([bal('a', 0), bal('b', 0)])).toEqual([])
  })

  it('routes one debtor to several creditors', () => {
    const plan = settlementPlan([bal('a', 6000), bal('b', 4000), bal('c', -10_000)])
    expect(plan).toHaveLength(2)
    expect(plan.every((t) => t.fromMember === 'c')).toBe(true)
    expect(plan.reduce((s, t) => s + t.amountMinor, 0)).toBe(10_000)
  })

  it('is deterministic when two people owe identical amounts', () => {
    // Equal amounts mean the only thing separating them is the id tie-break.
    const build = () => [bal('zeta', 10_000), bal('alpha', -5000), bal('beta', -5000)]
    expect(settlementPlan(build())).toEqual(settlementPlan(build()))
    expect(settlementPlan(build())[0]!.fromMember).toBe('alpha')
  })

  it('never emits a zero-value transfer', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const plan = settlementPlan(computeTotals(randomTrip(seed)).balances)
      expect(plan.every((t) => t.amountMinor > 0)).toBe(true)
    }
  })
})
