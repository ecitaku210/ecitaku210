import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Currency,
  Database,
  Expense,
  Id,
  Settlement,
  SplitMode,
  SplitPart,
  Trip,
} from '../domain/types'
import { mergeTripMaps, summariseMerge, type MergeSummary } from '../domain/merge'
import { loadDatabase, newId, saveDatabase, storageUsage, type StorageUsage } from './db'

/**
 * Single source of truth for the app.
 *
 * Every mutation below stamps `updatedAt` / `updatedBy` and uses a tombstone
 * instead of deleting. That discipline is what makes the merge correct — if
 * one mutation forgets it, two phones can silently disagree forever. Hence
 * `stamp()`: no component ever builds those fields by hand.
 */

interface StoreValue {
  db: Database
  usage: StorageUsage
  /** Set when a write failed, so the UI can stop pretending data is safe. */
  saveError: 'quota' | 'blocked' | null

  createTrip(name: string, currency: Currency, myName: string): Id
  renameTrip(tripId: Id, name: string): void
  deleteTrip(tripId: Id): void

  addMember(tripId: Id, name: string): Id
  renameMember(tripId: Id, memberId: Id, name: string): void
  removeMember(tripId: Id, memberId: Id): void
  setMyself(tripId: Id, memberId: Id): void

  saveExpense(tripId: Id, draft: ExpenseDraft): void
  deleteExpense(tripId: Id, expenseId: Id): void

  addSettlement(tripId: Id, s: SettlementDraft): void
  deleteSettlement(tripId: Id, settlementId: Id): void

  importTrips(trips: Record<Id, Trip>): MergeSummary
}

export interface ExpenseDraft {
  /** Absent for a new expense. */
  id?: Id
  description: string
  amountMinor: number
  paidBy: Id
  date: string
  splitMode: SplitMode
  parts: SplitPart[]
  note: string
}

export interface SettlementDraft {
  fromMember: Id
  toMember: Id
  amountMinor: number
  date: string
  note: string
}

const StoreContext = createContext<StoreValue | null>(null)

export function todayISO(): string {
  // Local date, not UTC: an expense added at 1am in Bangkok belongs to that
  // day there, not to yesterday in London.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database>(() => loadDatabase())
  const [saveError, setSaveError] = useState<'quota' | 'blocked' | null>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const result = saveDatabase(db)
    setSaveError(result.ok ? null : result.reason)
  }, [db])

  const stamp = useCallback(
    () => ({ updatedAt: Date.now(), updatedBy: db.deviceId, deletedAt: null as number | null }),
    [db.deviceId],
  )

  /** Applies a change to one trip and bumps nothing else. */
  const editTrip = useCallback((tripId: Id, fn: (trip: Trip) => Trip) => {
    setDb((prev) => {
      const trip = prev.trips[tripId]
      if (!trip) return prev
      return { ...prev, trips: { ...prev.trips, [tripId]: fn(trip) } }
    })
  }, [])

  const value = useMemo<StoreValue>(() => {
    return {
      db,
      usage: storageUsage(db),
      saveError,

      createTrip(name, currency, myName) {
        const tripId = newId()
        const memberId = newId()
        const now = Date.now()
        const trip: Trip = {
          id: tripId,
          name,
          currency,
          createdAt: now,
          updatedAt: now,
          updatedBy: db.deviceId,
          deletedAt: null,
          members: {
            [memberId]: {
              id: memberId,
              name: myName,
              updatedAt: now,
              updatedBy: db.deviceId,
              deletedAt: null,
            },
          },
          expenses: {},
          settlements: {},
        }
        setDb((prev) => ({
          ...prev,
          trips: { ...prev.trips, [tripId]: trip },
          identities: { ...prev.identities, [tripId]: memberId },
        }))
        return tripId
      },

      renameTrip(tripId, name) {
        editTrip(tripId, (trip) => ({ ...trip, name, ...stamp() }))
      },

      deleteTrip(tripId) {
        editTrip(tripId, (trip) => ({
          ...trip,
          updatedAt: Date.now(),
          updatedBy: db.deviceId,
          deletedAt: Date.now(),
        }))
      },

      addMember(tripId, name) {
        const memberId = newId()
        editTrip(tripId, (trip) => ({
          ...trip,
          members: {
            ...trip.members,
            [memberId]: { id: memberId, name, ...stamp() },
          },
        }))
        return memberId
      },

      renameMember(tripId, memberId, name) {
        editTrip(tripId, (trip) => {
          const member = trip.members[memberId]
          if (!member) return trip
          return {
            ...trip,
            members: { ...trip.members, [memberId]: { ...member, name, ...stamp() } },
          }
        })
      },

      removeMember(tripId, memberId) {
        editTrip(tripId, (trip) => {
          const member = trip.members[memberId]
          if (!member) return trip
          return {
            ...trip,
            members: {
              ...trip.members,
              [memberId]: {
                ...member,
                updatedAt: Date.now(),
                updatedBy: db.deviceId,
                deletedAt: Date.now(),
              },
            },
          }
        })
      },

      setMyself(tripId, memberId) {
        setDb((prev) => ({ ...prev, identities: { ...prev.identities, [tripId]: memberId } }))
      },

      saveExpense(tripId, draft) {
        editTrip(tripId, (trip) => {
          const existing = draft.id ? trip.expenses[draft.id] : undefined
          const id = draft.id ?? newId()
          const expense: Expense = {
            id,
            description: draft.description,
            amountMinor: draft.amountMinor,
            paidBy: draft.paidBy,
            date: draft.date,
            splitMode: draft.splitMode,
            parts: draft.parts,
            note: draft.note,
            createdAt: existing?.createdAt ?? Date.now(),
            ...stamp(),
          }
          return { ...trip, expenses: { ...trip.expenses, [id]: expense } }
        })
      },

      deleteExpense(tripId, expenseId) {
        editTrip(tripId, (trip) => {
          const expense = trip.expenses[expenseId]
          if (!expense) return trip
          const now = Date.now()
          return {
            ...trip,
            expenses: {
              ...trip.expenses,
              [expenseId]: { ...expense, updatedAt: now, updatedBy: db.deviceId, deletedAt: now },
            },
          }
        })
      },

      addSettlement(tripId, draft) {
        const id = newId()
        editTrip(tripId, (trip) => {
          const settlement: Settlement = { id, ...draft, createdAt: Date.now(), ...stamp() }
          return { ...trip, settlements: { ...trip.settlements, [id]: settlement } }
        })
      },

      deleteSettlement(tripId, settlementId) {
        editTrip(tripId, (trip) => {
          const s = trip.settlements[settlementId]
          if (!s) return trip
          const now = Date.now()
          return {
            ...trip,
            settlements: {
              ...trip.settlements,
              [settlementId]: { ...s, updatedAt: now, updatedBy: db.deviceId, deletedAt: now },
            },
          }
        })
      },

      importTrips(incoming) {
        // Merged once and reused for both the summary and the new state.
        // Merging twice was pure waste on a large ledger, and under
        // StrictMode's double-invoked updater it ran three times.
        const merged = mergeTripMaps(db.trips, incoming)
        const summary = summariseMerge(db.trips, merged)
        setDb((prev) => ({
          ...prev,
          // If another change landed between render and commit, redo the
          // merge against what is actually current rather than clobbering it.
          trips: prev.trips === db.trips ? merged : mergeTripMaps(prev.trips, incoming),
        }))
        return summary
      },
    }
  }, [db, saveError, editTrip, stamp])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside <StoreProvider>')
  return value
}

export function useTrip(tripId: Id | null): Trip | null {
  const { db } = useStore()
  if (!tripId) return null
  const trip = db.trips[tripId]
  return trip && trip.deletedAt === null ? trip : null
}
