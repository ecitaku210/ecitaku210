import type { Expense, Id, Trip, Versioned } from './types'

/**
 * Merging replicas.
 *
 * This is the load-bearing file. With no server, correctness of the whole app
 * reduces to: can two phones exchange files and end up agreeing?
 *
 * The structure is an LWW-Element-Set, a CRDT. Merge is:
 *   - COMMUTATIVE   merge(a, b) === merge(b, a)
 *   - ASSOCIATIVE   merge(merge(a, b), c) === merge(a, merge(b, c))
 *   - IDEMPOTENT    merge(a, a) === a
 *
 * Those three properties are what make the practical workflow safe: everyone
 * can send everyone their file, in any order, over and over, and nobody ends
 * up with a duplicated dinner or a resurrected deleted expense. The test
 * suite asserts all three against randomly generated ledgers.
 *
 * WHAT THIS DOES NOT SOLVE, and no algorithm can: if you and your friend both
 * type in the same dinner as two separate entries, those are two genuinely
 * different records with different ids, and the merge keeps both — correctly,
 * because it cannot know they are the same meal. `findProbableDuplicates`
 * flags them for a human to decide.
 */

/**
 * Total order over versions, so conflict resolution is identical everywhere.
 * 1. newer wall clock wins
 * 2. tie -> higher device id wins (arbitrary, but the SAME arbitrary choice
 *    on every phone, which is the only thing that matters)
 * 3. still tied -> compare the serialised record, so even a same-device,
 *    same-millisecond double edit resolves deterministically
 */
function pickWinner<T extends Versioned>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (a.updatedBy !== b.updatedBy) return a.updatedBy > b.updatedBy ? a : b
  const sa = stableStringify(a)
  const sb = stableStringify(b)
  if (sa === sb) return a
  return sa > sb ? a : b
}

/** JSON with sorted keys, so two equal objects always serialise identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function mergeRecords<T extends Versioned & { id: Id }>(
  a: Record<Id, T>,
  b: Record<Id, T>,
): Record<Id, T> {
  const out: Record<Id, T> = {}
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[id]
    const right = b[id]
    if (left && right) out[id] = pickWinner(left, right)
    else out[id] = (left ?? right)!
  }
  return out
}

export function mergeTrip(a: Trip, b: Trip): Trip {
  if (a.id !== b.id) throw new Error('Refusing to merge two different trips.')
  // Trip-level fields (name, currency) follow the same LWW rule as records.
  const meta = pickWinner(a, b)
  return {
    ...meta,
    id: a.id,
    createdAt: Math.min(a.createdAt, b.createdAt),
    members: mergeRecords(a.members, b.members),
    expenses: mergeRecords(a.expenses, b.expenses),
    settlements: mergeRecords(a.settlements, b.settlements),
  }
}

export function mergeTripMaps(
  a: Record<Id, Trip>,
  b: Record<Id, Trip>,
): Record<Id, Trip> {
  const out: Record<Id, Trip> = {}
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[id]
    const right = b[id]
    if (left && right) out[id] = mergeTrip(left, right)
    else out[id] = (left ?? right)!
  }
  return out
}

export interface MergeSummary {
  tripsAdded: number
  tripsUpdated: number
  expensesAdded: number
  expensesChanged: number
  settlementsAdded: number
  membersAdded: number
}

/** What actually changed, so the import screen can report it honestly. */
export function summariseMerge(
  before: Record<Id, Trip>,
  after: Record<Id, Trip>,
): MergeSummary {
  const s: MergeSummary = {
    tripsAdded: 0,
    tripsUpdated: 0,
    expensesAdded: 0,
    expensesChanged: 0,
    settlementsAdded: 0,
    membersAdded: 0,
  }
  for (const [tripId, next] of Object.entries(after)) {
    const prev = before[tripId]
    if (!prev) {
      s.tripsAdded += 1
      s.expensesAdded += Object.keys(next.expenses).length
      s.settlementsAdded += Object.keys(next.settlements).length
      s.membersAdded += Object.keys(next.members).length
      continue
    }
    let touched = false
    for (const [id, e] of Object.entries(next.expenses)) {
      const old = prev.expenses[id]
      if (!old) { s.expensesAdded += 1; touched = true }
      else if (old.updatedAt !== e.updatedAt) { s.expensesChanged += 1; touched = true }
    }
    for (const id of Object.keys(next.settlements)) {
      if (!prev.settlements[id]) { s.settlementsAdded += 1; touched = true }
    }
    for (const id of Object.keys(next.members)) {
      if (!prev.members[id]) { s.membersAdded += 1; touched = true }
    }
    if (touched) s.tripsUpdated += 1
  }
  return s
}

export interface DuplicateGroup {
  reason: string
  expenses: Expense[]
}

/**
 * Advisory only — never auto-deletes.
 *
 * Two people logging the same taxi produce two valid, distinct records. The
 * merge cannot tell them apart from a genuine pair of identical fares, so it
 * keeps both and this function raises a hand: same day, same amount, same
 * payer. A human decides.
 */
export function findProbableDuplicates(trip: Trip): DuplicateGroup[] {
  const buckets = new Map<string, Expense[]>()
  for (const e of Object.values(trip.expenses)) {
    if (e.deletedAt !== null) continue
    const key = `${e.date}|${e.amountMinor}|${e.paidBy}`
    const list = buckets.get(key)
    if (list) list.push(e)
    else buckets.set(key, [e])
  }

  const groups: DuplicateGroup[] = []
  for (const list of buckets.values()) {
    if (list.length < 2) continue
    // Entries made on the same device are almost certainly deliberate
    // (two identical coffees), so only flag cross-device collisions.
    const devices = new Set(list.map((e) => e.updatedBy))
    if (devices.size < 2) continue
    groups.push({
      reason: 'Same date, same amount, same payer — entered on different phones.',
      expenses: [...list].sort((a, b) => a.createdAt - b.createdAt),
    })
  }
  return groups
}
