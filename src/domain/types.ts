/**
 * Core data model.
 *
 * MONEY IS NEVER A FLOAT.
 * Every amount is an integer count of *minor units* (paise, cents, fils).
 * `12.35` is stored as `1235`. Floating point cannot represent 0.1 exactly,
 * so `0.1 + 0.2 !== 0.3`; on a shared ledger that drift turns into arguments
 * about who owes 1 paisa. Integers make the arithmetic exact.
 *
 * REPLICATION MODEL — LWW-Element-Set (a CRDT).
 * There is no server. Each phone holds a full replica and phones exchange
 * files. Every record therefore carries:
 *   - `id`         a UUID minted on the creating device, so two devices can
 *                  never mint the same id and merging is a set union
 *   - `updatedAt`  wall-clock ms of the last edit
 *   - `updatedBy`  the editing device's id, used ONLY to break `updatedAt`
 *                  ties so every device resolves a conflict identically
 *   - `deletedAt`  a tombstone; a deleted record is kept, not removed,
 *                  otherwise a merge with a stale replica would resurrect it
 */

export type Id = string

/** Integer count of minor units. Positive, negative, or zero. */
export type Minor = number

/** Fields every replicated record carries. See LWW note above. */
export interface Versioned {
  updatedAt: number
  updatedBy: Id
  deletedAt: number | null
}

export interface Currency {
  /** ISO 4217 where one exists, e.g. "INR". Free text is tolerated. */
  code: string
  symbol: string
  /** Minor units per major unit, as a power of 10. INR/USD = 2, JPY = 0. */
  decimals: number
}

export interface Member extends Versioned {
  id: Id
  name: string
}

/**
 * How an expense is divided.
 * - `equal`   every participant pays the same (remainder handled explicitly)
 * - `exact`   each participant's weight IS the amount they owe, in minor units
 * - `shares`  weights are relative share counts, e.g. 2 for a couple in one room
 * - `percent` weights are basis points (1% = 100) so they stay integers
 */
export type SplitMode = 'equal' | 'exact' | 'shares' | 'percent'

export interface SplitPart {
  memberId: Id
  /** Meaning depends on SplitMode — see the SplitMode docs. */
  weight: number
}

export interface Expense extends Versioned {
  id: Id
  description: string
  amountMinor: Minor
  /**
   * The single member who fronted the cash.
   * If two people genuinely split one bill at the till, log two expenses.
   * Keeping this single-valued keeps the balance math and the UI honest.
   */
  paidBy: Id
  /** ISO calendar date, `YYYY-MM-DD`. Local to whoever entered it. */
  date: string
  splitMode: SplitMode
  parts: SplitPart[]
  note: string
  createdAt: number
}

/** A real cash/transfer repayment between two members. */
export interface Settlement extends Versioned {
  id: Id
  fromMember: Id
  toMember: Id
  amountMinor: Minor
  date: string
  note: string
  createdAt: number
}

export interface Trip extends Versioned {
  id: Id
  name: string
  currency: Currency
  createdAt: number
  members: Record<Id, Member>
  expenses: Record<Id, Expense>
  settlements: Record<Id, Settlement>
}

/** Bumped only when a change would break older replicas' ability to merge. */
export const SCHEMA_VERSION = 1

/** The unit of export/import: one or more whole trips. */
export interface LedgerFile {
  kind: 'tripsplit.ledger'
  schema: number
  exportedAt: number
  exportedBy: Id
  trips: Record<Id, Trip>
}

/** Everything one device knows. Persisted locally, never transmitted whole. */
export interface Database {
  schema: number
  deviceId: Id
  /** Which member in each trip this phone's owner is. tripId -> memberId. */
  identities: Record<Id, Id>
  trips: Record<Id, Trip>
}
