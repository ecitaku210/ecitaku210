import type { Database, Id } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'

const KEY = 'tripsplit.db.v1'
const DEVICE_KEY = 'tripsplit.device.v1'

/**
 * localStorage, not IndexedDB.
 *
 * This ledger is text only — no photos — so a 20-person, 1000-expense trip
 * lands around 300 KB, comfortably inside the ~5 MB localStorage budget.
 * IndexedDB would buy far more room at the cost of an async API threaded
 * through every component, which is not a trade worth making for this data.
 * `storageUsage` watches the ceiling so the app can warn instead of silently
 * failing to save.
 *
 * Every access is wrapped: Safari in Private Browsing and some in-app
 * browsers throw on `localStorage` access rather than returning null.
 */

export function newId(): Id {
  // randomUUID exists only in a secure context, so it is absent over plain
  // http on a LAN address — exactly how you test on a real phone. Fall back
  // to getRandomValues, and only then to Math.random.
  const webcrypto: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto
  if (typeof webcrypto?.randomUUID === 'function') return webcrypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof webcrypto?.getRandomValues === 'function') webcrypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/**
 * The device id identifies this phone's replica. It is stored separately from
 * the database so that clearing trips does not change the device's identity,
 * which would otherwise scramble LWW tie-breaking against files the group
 * already holds.
 */
export function getDeviceId(): Id {
  const existing = safeGet(DEVICE_KEY)
  if (existing) return existing
  const fresh = newId()
  safeSet(DEVICE_KEY, fresh)
  return fresh
}

export function emptyDatabase(): Database {
  return { schema: SCHEMA_VERSION, deviceId: getDeviceId(), identities: {}, trips: {} }
}

export function loadDatabase(): Database {
  const raw = safeGet(KEY)
  if (!raw) return emptyDatabase()
  try {
    const parsed = JSON.parse(raw) as Partial<Database>
    return {
      schema: SCHEMA_VERSION,
      deviceId: getDeviceId(),
      identities: typeof parsed.identities === 'object' && parsed.identities ? parsed.identities : {},
      trips: typeof parsed.trips === 'object' && parsed.trips ? parsed.trips : {},
    }
  } catch {
    // A corrupt blob is kept under a side key rather than overwritten, so a
    // hand-recovery is still possible instead of the trip being gone.
    safeSet(`${KEY}.corrupt.${Date.now()}`, raw)
    return emptyDatabase()
  }
}

export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'blocked' }

export function saveDatabase(db: Database): SaveResult {
  const payload = JSON.stringify(db)
  if (safeSet(KEY, payload)) return { ok: true }
  // Distinguish "disk full" from "storage disabled", because the advice the
  // user needs is completely different.
  return { ok: false, reason: safeGet(KEY) === null ? 'blocked' : 'quota' }
}

export interface StorageUsage {
  usedBytes: number
  /** Conservative floor for the per-origin localStorage budget. */
  limitBytes: number
  ratio: number
}

export function storageUsage(db: Database): StorageUsage {
  const usedBytes = new Blob([JSON.stringify(db)]).size
  const limitBytes = 5 * 1024 * 1024
  return { usedBytes, limitBytes, ratio: usedBytes / limitBytes }
}
