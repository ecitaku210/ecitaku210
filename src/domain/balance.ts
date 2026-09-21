import type { Expense, Id, Minor, Settlement, Trip } from './types'
import { computeSplit } from './split'

export interface MemberBalance {
  memberId: Id
  /** Total this member fronted for the group. */
  paidMinor: Minor
  /** Total this member consumed, i.e. their share of every expense. */
  owedMinor: Minor
  /** Repayments this member handed over. */
  settledOutMinor: Minor
  /** Repayments this member received. */
  settledInMinor: Minor
  /**
   * The single number that matters.
   *   > 0  the group owes this member
   *   < 0  this member owes the group
   *   = 0  square
   */
  netMinor: Minor
}

export interface TripTotals {
  /** Sum of every live expense. */
  totalSpentMinor: Minor
  balances: MemberBalance[]
  /** Expenses that could not be split (bad data from an older/buggy replica). */
  problems: { expenseId: Id; message: string }[]
}

export function liveExpenses(trip: Trip): Expense[] {
  return Object.values(trip.expenses)
    .filter((e) => e.deletedAt === null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export function liveSettlements(trip: Trip): Settlement[] {
  return Object.values(trip.settlements)
    .filter((s) => s.deletedAt === null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export function liveMembers(trip: Trip) {
  return Object.values(trip.members)
    .filter((m) => m.deletedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
}

/**
 * Compute where everyone stands.
 *
 * net = (what you paid out) - (what you consumed)
 *       + (repayments you made) - (repayments you received)
 *
 * The two settlement terms have those signs because handing cash to someone
 * you owe *reduces* your debt, which moves your net upward.
 *
 * INVARIANT: the nets of all members sum to zero. Money is only ever moved
 * between members, never created. `assertBalanced` checks this, and the test
 * suite asserts it over randomised ledgers.
 */
export function computeTotals(trip: Trip): TripTotals {
  const members = liveMembers(trip)
  const index = new Map<Id, MemberBalance>()
  for (const m of members) {
    index.set(m.id, {
      memberId: m.id,
      paidMinor: 0,
      owedMinor: 0,
      settledOutMinor: 0,
      settledInMinor: 0,
      netMinor: 0,
    })
  }

  const problems: TripTotals['problems'] = []
  let totalSpentMinor = 0

  for (const expense of liveExpenses(trip)) {
    // A member removed after an expense was logged still has to carry their
    // share, otherwise deleting a person would quietly rewrite history.
    // So we look up by id and tolerate a missing (deleted) member by
    // re-creating a zeroed row for them rather than dropping the expense.
    const payer = index.get(expense.paidBy) ?? ensureRow(index, expense.paidBy)

    const split = computeSplit(expense.amountMinor, expense.splitMode, expense.parts)
    if (!split.ok) {
      problems.push({ expenseId: expense.id, message: split.message })
      continue
    }

    totalSpentMinor += expense.amountMinor
    payer.paidMinor += expense.amountMinor

    for (const [memberId, share] of split.shares) {
      const row = index.get(memberId) ?? ensureRow(index, memberId)
      row.owedMinor += share
    }
  }

  for (const s of liveSettlements(trip)) {
    if (s.fromMember === s.toMember) continue
    if (s.amountMinor <= 0) continue
    const from = index.get(s.fromMember) ?? ensureRow(index, s.fromMember)
    const to = index.get(s.toMember) ?? ensureRow(index, s.toMember)
    from.settledOutMinor += s.amountMinor
    to.settledInMinor += s.amountMinor
  }

  const balances = [...index.values()]
  for (const b of balances) {
    b.netMinor = b.paidMinor - b.owedMinor + b.settledOutMinor - b.settledInMinor
  }

  balances.sort((a, b) => b.netMinor - a.netMinor || (a.memberId < b.memberId ? -1 : 1))
  return { totalSpentMinor, balances, problems }
}

function ensureRow(index: Map<Id, MemberBalance>, memberId: Id): MemberBalance {
  const row: MemberBalance = {
    memberId,
    paidMinor: 0,
    owedMinor: 0,
    settledOutMinor: 0,
    settledInMinor: 0,
    netMinor: 0,
  }
  index.set(memberId, row)
  return row
}

/** Returns the imbalance; anything other than 0 is a bug in this file. */
export function assertBalanced(totals: TripTotals): Minor {
  return totals.balances.reduce((a, b) => a + b.netMinor, 0)
}
