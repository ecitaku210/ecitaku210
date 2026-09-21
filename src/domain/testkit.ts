import type { Expense, Id, Member, Settlement, SplitMode, Trip } from './types'

/**
 * Deterministic pseudo-random generator for the property tests.
 * Math.random would make a failing test unreproducible, which is useless when
 * the failure is a one-paisa rounding drift that only shows up occasionally.
 */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    // xorshift32
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x1_0000_0000
  }
}

export function makeMember(id: Id, name: string, at = 1000, by = 'devA'): Member {
  return { id, name, updatedAt: at, updatedBy: by, deletedAt: null }
}

export function makeTrip(id = 'trip1', members: Member[] = []): Trip {
  return {
    id,
    name: 'Test Trip',
    currency: { code: 'INR', symbol: '₹', decimals: 2 },
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: 'devA',
    deletedAt: null,
    members: Object.fromEntries(members.map((m) => [m.id, m])),
    expenses: {},
    settlements: {},
  }
}

export function makeExpense(over: Partial<Expense> & Pick<Expense, 'id'>): Expense {
  return {
    description: 'Thing',
    amountMinor: 10000,
    paidBy: 'm1',
    date: '2026-01-01',
    splitMode: 'equal',
    parts: [{ memberId: 'm1', weight: 1 }],
    note: '',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: 'devA',
    deletedAt: null,
    ...over,
  }
}

export function makeSettlement(
  over: Partial<Settlement> & Pick<Settlement, 'id'>,
): Settlement {
  return {
    fromMember: 'm1',
    toMember: 'm2',
    amountMinor: 1000,
    date: '2026-01-01',
    note: '',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: 'devA',
    deletedAt: null,
    ...over,
  }
}

/** Builds a messy but internally valid trip: odd amounts, mixed split modes. */
export function randomTrip(seed: number, memberCount = 5, expenseCount = 40): Trip {
  const rand = rng(seed)
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

  const members = Array.from({ length: memberCount }, (_, i) =>
    makeMember(`m${i}`, `Member ${i}`),
  )
  const trip = makeTrip('trip1', members)
  const ids = members.map((m) => m.id)

  for (let i = 0; i < expenseCount; i += 1) {
    const participants = ids.filter(() => rand() > 0.25)
    if (participants.length === 0) participants.push(pick(ids))
    // Deliberately awkward totals so remainders are exercised constantly.
    const amountMinor = int(1, 999_999)
    const mode = pick<SplitMode>(['equal', 'equal', 'shares', 'percent', 'exact'])

    let parts = participants.map((memberId) => ({ memberId, weight: 1 }))
    if (mode === 'shares') {
      parts = participants.map((memberId) => ({ memberId, weight: int(1, 5) }))
    } else if (mode === 'percent') {
      // Hand out 10000 basis points so they always total exactly 100%.
      const weights = splitIntegerRandomly(10_000, participants.length, rand)
      parts = participants.map((memberId, k) => ({ memberId, weight: weights[k]! }))
    } else if (mode === 'exact') {
      const weights = splitIntegerRandomly(amountMinor, participants.length, rand)
      parts = participants.map((memberId, k) => ({ memberId, weight: weights[k]! }))
    }

    trip.expenses[`e${i}`] = makeExpense({
      id: `e${i}`,
      amountMinor,
      paidBy: pick(ids),
      splitMode: mode,
      parts,
      createdAt: 1000 + i,
      updatedAt: 1000 + i,
    })
  }

  const settlementCount = Math.floor(expenseCount / 8)
  for (let i = 0; i < settlementCount; i += 1) {
    const from = pick(ids)
    const to = pick(ids.filter((x) => x !== from))
    trip.settlements[`s${i}`] = makeSettlement({
      id: `s${i}`,
      fromMember: from,
      toMember: to,
      amountMinor: int(1, 50_000),
      createdAt: 2000 + i,
      updatedAt: 2000 + i,
    })
  }

  return trip
}

/** Splits `total` into `n` non-negative integers that sum to exactly `total`. */
function splitIntegerRandomly(total: number, n: number, rand: () => number): number[] {
  if (n === 1) return [total]
  const cuts = Array.from({ length: n - 1 }, () => Math.floor(rand() * (total + 1))).sort(
    (a, b) => a - b,
  )
  const out: number[] = []
  let prev = 0
  for (const c of cuts) {
    out.push(c - prev)
    prev = c
  }
  out.push(total - prev)
  return out
}
