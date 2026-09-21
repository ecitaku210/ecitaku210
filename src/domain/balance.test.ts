import { describe, expect, it } from 'vitest'
import { assertBalanced, computeTotals } from './balance'
import { makeExpense, makeMember, makeSettlement, makeTrip, randomTrip } from './testkit'

const net = (trip: Parameters<typeof computeTotals>[0], memberId: string) =>
  computeTotals(trip).balances.find((b) => b.memberId === memberId)!.netMinor

describe('computeTotals — the zero-sum invariant', () => {
  it('nets to zero on 200 randomly generated ledgers', () => {
    // If this ever fails, money is being created or destroyed somewhere in
    // the split/settlement arithmetic — the single worst class of bug here.
    for (let seed = 1; seed <= 200; seed += 1) {
      const totals = computeTotals(randomTrip(seed))
      expect(assertBalanced(totals)).toBe(0)
    }
  })

  it('nets to zero for a large group with many expenses', () => {
    expect(assertBalanced(computeTotals(randomTrip(7, 12, 400)))).toBe(0)
  })
})

describe('computeTotals — scenarios you can check on paper', () => {
  const members = [makeMember('m1', 'Asha'), makeMember('m2', 'Bilal'), makeMember('m3', 'Chen')]

  it('one person pays for everyone', () => {
    const trip = makeTrip('t', members)
    trip.expenses.e1 = makeExpense({
      id: 'e1',
      amountMinor: 30_000, // ₹300
      paidBy: 'm1',
      parts: [
        { memberId: 'm1', weight: 1 },
        { memberId: 'm2', weight: 1 },
        { memberId: 'm3', weight: 1 },
      ],
    })
    expect(net(trip, 'm1')).toBe(20_000) // paid 300, ate 100
    expect(net(trip, 'm2')).toBe(-10_000)
    expect(net(trip, 'm3')).toBe(-10_000)
  })

  it('a payer who is not a participant is owed the whole amount', () => {
    const trip = makeTrip('t', members)
    trip.expenses.e1 = makeExpense({
      id: 'e1',
      amountMinor: 10_000,
      paidBy: 'm1',
      parts: [
        { memberId: 'm2', weight: 1 },
        { memberId: 'm3', weight: 1 },
      ],
    })
    expect(net(trip, 'm1')).toBe(10_000)
    expect(net(trip, 'm2')).toBe(-5000)
  })

  it('a repayment moves the debtor toward zero and the creditor down', () => {
    const trip = makeTrip('t', members)
    trip.expenses.e1 = makeExpense({
      id: 'e1',
      amountMinor: 20_000,
      paidBy: 'm1',
      parts: [
        { memberId: 'm1', weight: 1 },
        { memberId: 'm2', weight: 1 },
      ],
    })
    expect(net(trip, 'm2')).toBe(-10_000)
    trip.settlements.s1 = makeSettlement({
      id: 's1',
      fromMember: 'm2',
      toMember: 'm1',
      amountMinor: 10_000,
    })
    expect(net(trip, 'm2')).toBe(0)
    expect(net(trip, 'm1')).toBe(0)
  })

  it('ignores a deleted expense but keeps its tombstone', () => {
    const trip = makeTrip('t', members)
    trip.expenses.e1 = makeExpense({
      id: 'e1',
      amountMinor: 20_000,
      paidBy: 'm1',
      parts: [
        { memberId: 'm1', weight: 1 },
        { memberId: 'm2', weight: 1 },
      ],
      deletedAt: 5000,
    })
    expect(computeTotals(trip).totalSpentMinor).toBe(0)
    expect(net(trip, 'm1')).toBe(0)
    expect(trip.expenses.e1).toBeDefined()
  })

  it('still charges a member who was removed after the expense', () => {
    // Deleting a person must not quietly rewrite what they already consumed.
    const trip = makeTrip('t', [
      makeMember('m1', 'Asha'),
      { ...makeMember('m2', 'Bilal'), deletedAt: 9000 },
    ])
    trip.expenses.e1 = makeExpense({
      id: 'e1',
      amountMinor: 10_000,
      paidBy: 'm1',
      parts: [
        { memberId: 'm1', weight: 1 },
        { memberId: 'm2', weight: 1 },
      ],
    })
    expect(net(trip, 'm2')).toBe(-5000)
    expect(assertBalanced(computeTotals(trip))).toBe(0)
  })

  it('reports a corrupt expense instead of silently skewing the books', () => {
    const trip = makeTrip('t', members)
    trip.expenses.bad = makeExpense({
      id: 'bad',
      amountMinor: 10_000,
      splitMode: 'exact',
      parts: [{ memberId: 'm1', weight: 1 }], // does not reconcile
    })
    const totals = computeTotals(trip)
    expect(totals.problems).toHaveLength(1)
    expect(totals.totalSpentMinor).toBe(0)
    expect(assertBalanced(totals)).toBe(0)
  })

  it('ignores a self-settlement and a non-positive one', () => {
    const trip = makeTrip('t', members)
    trip.settlements.s1 = makeSettlement({ id: 's1', fromMember: 'm1', toMember: 'm1' })
    trip.settlements.s2 = makeSettlement({ id: 's2', amountMinor: 0 })
    expect(assertBalanced(computeTotals(trip))).toBe(0)
    expect(net(trip, 'm1')).toBe(0)
  })
})
