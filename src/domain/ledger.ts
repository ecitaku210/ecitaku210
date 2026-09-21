import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate'
import type {
  Currency,
  Expense,
  Id,
  LedgerFile,
  Member,
  Settlement,
  SplitMode,
  Trip,
} from './types'
import { SCHEMA_VERSION } from './types'
import { isValidMinor } from './money'

/**
 * Import is the app's only untrusted input. A ledger file arrives over
 * WhatsApp or AirDrop and could be truncated, hand-edited, from a future
 * version, or simply not a ledger at all. Everything below is defensive:
 * unknown fields are dropped, malformed records are rejected individually
 * rather than failing the whole import, and nothing is ever `eval`ed.
 *
 * The decoded object goes straight into the merge, so a bad record here
 * would corrupt every phone it later spreads to.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SPLIT_MODES: SplitMode[] = ['equal', 'exact', 'shares', 'percent']
/** Guards against a decompression bomb from a hostile or corrupt file. */
const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024
/** ~8 MB of base64 text. A 1000-expense trip encodes to well under 100 KB. */
const MAX_COMPRESSED_CHARS = 8 * 1024 * 1024

export interface ParseResult {
  ok: true
  file: LedgerFile
  /** Records dropped for being malformed — surfaced, never silent. */
  warnings: string[]
}
export interface ParseFailure {
  ok: false
  message: string
}

function str(v: unknown, max = 500): string | null {
  if (typeof v !== 'string') return null
  if (v.length > max) return v.slice(0, max)
  return v
}

/**
 * Ids become object keys (`trip.expenses[id] = record`). A record whose id is
 * `__proto__` would therefore reassign the map's prototype instead of adding
 * an entry — the record silently disappears from `Object.values` while its
 * fields start resolving on every lookup of that map. These three names are
 * the only strings where `obj[key] = value` does not mean what it reads like,
 * so they are rejected outright.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function id(v: unknown): Id | null {
  if (typeof v !== 'string') return null
  if (v.length < 1 || v.length > 64) return null
  if (UNSAFE_KEYS.has(v)) return null
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null
}

function ts(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 4e15 ? v : null
}

function tombstone(v: unknown): number | null | undefined {
  if (v === null) return null
  return ts(v) ?? undefined
}

function parseCurrency(v: unknown): Currency | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const code = str(o.code, 12)
  const symbol = str(o.symbol, 8)
  const decimals = o.decimals
  if (code === null || symbol === null) return null
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 4)
    return null
  return { code, symbol, decimals }
}

function parseMember(v: unknown): Member | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const mid = id(o.id)
  const name = str(o.name, 80)
  const updatedAt = ts(o.updatedAt)
  const updatedBy = id(o.updatedBy)
  const deletedAt = tombstone(o.deletedAt)
  if (mid === null || name === null || updatedAt === null || updatedBy === null) return null
  if (deletedAt === undefined) return null
  return { id: mid, name, updatedAt, updatedBy, deletedAt }
}

function parseExpense(v: unknown): Expense | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const eid = id(o.id)
  const description = str(o.description, 200)
  const paidBy = id(o.paidBy)
  const date = str(o.date, 10)
  const updatedAt = ts(o.updatedAt)
  const createdAt = ts(o.createdAt)
  const updatedBy = id(o.updatedBy)
  const deletedAt = tombstone(o.deletedAt)
  const note = str(o.note, 500) ?? ''

  if (eid === null || description === null || paidBy === null) return null
  if (date === null || !ISO_DATE.test(date)) return null
  if (updatedAt === null || createdAt === null || updatedBy === null) return null
  if (deletedAt === undefined) return null
  if (!isValidMinor(o.amountMinor) || (o.amountMinor as number) <= 0) return null
  if (typeof o.splitMode !== 'string' || !SPLIT_MODES.includes(o.splitMode as SplitMode))
    return null
  if (!Array.isArray(o.parts) || o.parts.length === 0 || o.parts.length > 200) return null

  const parts: Expense['parts'] = []
  for (const p of o.parts) {
    if (typeof p !== 'object' || p === null) return null
    const po = p as Record<string, unknown>
    const memberId = id(po.memberId)
    if (memberId === null) return null
    if (typeof po.weight !== 'number' || !Number.isSafeInteger(po.weight) || po.weight < 0)
      return null
    parts.push({ memberId, weight: po.weight })
  }

  return {
    id: eid,
    description,
    amountMinor: o.amountMinor as number,
    paidBy,
    date,
    splitMode: o.splitMode as SplitMode,
    parts,
    note,
    createdAt,
    updatedAt,
    updatedBy,
    deletedAt,
  }
}

function parseSettlement(v: unknown): Settlement | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const sid = id(o.id)
  const fromMember = id(o.fromMember)
  const toMember = id(o.toMember)
  const date = str(o.date, 10)
  const updatedAt = ts(o.updatedAt)
  const createdAt = ts(o.createdAt)
  const updatedBy = id(o.updatedBy)
  const deletedAt = tombstone(o.deletedAt)
  const note = str(o.note, 500) ?? ''

  if (sid === null || fromMember === null || toMember === null) return null
  if (date === null || !ISO_DATE.test(date)) return null
  if (updatedAt === null || createdAt === null || updatedBy === null) return null
  if (deletedAt === undefined) return null
  if (!isValidMinor(o.amountMinor) || (o.amountMinor as number) <= 0) return null

  return {
    id: sid,
    fromMember,
    toMember,
    amountMinor: o.amountMinor as number,
    date,
    note,
    createdAt,
    updatedAt,
    updatedBy,
    deletedAt,
  }
}

function parseTrip(v: unknown, warnings: string[]): Trip | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const tid = id(o.id)
  const name = str(o.name, 120)
  const currency = parseCurrency(o.currency)
  const createdAt = ts(o.createdAt)
  const updatedAt = ts(o.updatedAt)
  const updatedBy = id(o.updatedBy)
  const deletedAt = tombstone(o.deletedAt)
  if (tid === null || name === null || currency === null) return null
  if (createdAt === null || updatedAt === null || updatedBy === null) return null
  if (deletedAt === undefined) return null

  const trip: Trip = {
    id: tid,
    name,
    currency,
    createdAt,
    updatedAt,
    updatedBy,
    deletedAt,
    members: {},
    expenses: {},
    settlements: {},
  }

  collect(o.members, parseMember, trip.members, warnings, `trip "${name}" member`)
  collect(o.expenses, parseExpense, trip.expenses, warnings, `trip "${name}" expense`)
  collect(
    o.settlements,
    parseSettlement,
    trip.settlements,
    warnings,
    `trip "${name}" settlement`,
  )
  return trip
}

function collect<T extends { id: Id }>(
  source: unknown,
  parse: (v: unknown) => T | null,
  into: Record<Id, T>,
  warnings: string[],
  label: string,
): void {
  if (typeof source !== 'object' || source === null) return
  let dropped = 0
  for (const raw of Object.values(source as Record<string, unknown>)) {
    const parsed = parse(raw)
    if (parsed) into[parsed.id] = parsed
    else dropped += 1
  }
  if (dropped > 0) warnings.push(`Skipped ${dropped} unreadable ${label} record(s).`)
}

export function parseLedger(raw: unknown): ParseResult | ParseFailure {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'That file is not a TripSplit ledger.' }
  }
  const o = raw as Record<string, unknown>
  if (o.kind !== 'tripsplit.ledger') {
    return { ok: false, message: 'That file is not a TripSplit ledger.' }
  }
  const schema = o.schema
  if (typeof schema !== 'number' || !Number.isInteger(schema)) {
    return { ok: false, message: 'Ledger is missing a version number.' }
  }
  if (schema > SCHEMA_VERSION) {
    return {
      ok: false,
      message:
        `This ledger was written by a newer version of TripSplit (v${schema}). ` +
        `Update your app first — importing it now could lose data.`,
    }
  }

  const warnings: string[] = []
  const trips: Record<Id, Trip> = {}
  if (typeof o.trips === 'object' && o.trips !== null) {
    for (const raw of Object.values(o.trips as Record<string, unknown>)) {
      const trip = parseTrip(raw, warnings)
      if (trip) trips[trip.id] = trip
      else warnings.push('Skipped one unreadable trip.')
    }
  }
  if (Object.keys(trips).length === 0) {
    return { ok: false, message: 'No readable trips in that file.' }
  }

  return {
    ok: true,
    warnings,
    file: {
      kind: 'tripsplit.ledger',
      schema: SCHEMA_VERSION,
      exportedAt: ts(o.exportedAt) ?? Date.now(),
      exportedBy: id(o.exportedBy) ?? 'unknown',
      trips,
    },
  }
}

/* ----------------------------------------------------------------------- */
/* Transport encoding                                                       */
/* ----------------------------------------------------------------------- */

/**
 * base64url rather than plain base64 so the payload survives being pasted
 * into a URL fragment without `+`, `/` or `=` being mangled.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000 // avoid blowing the argument limit on large ledgers
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const normalised = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Ledgers are mostly repeated names and UUID prefixes, so gzip typically
 * cuts a share code to a fifth of its size. That decides whether a code can
 * be pasted into a chat at all.
 */
export function encodeLedger(file: LedgerFile): string {
  const json = JSON.stringify(file)
  return toBase64Url(gzipSync(strToU8(json), { level: 9 }))
}

/**
 * A gzip stream ends with ISIZE: the uncompressed length, little-endian.
 * Reading it costs nothing and lets a decompression bomb be refused before
 * any memory is allocated for it — fflate has no size cap of its own.
 *
 * ISIZE is stored modulo 2^32, so a payload above 4 GB could under-report.
 * The input-length cap below closes that off: no real ledger comes anywhere
 * near either limit.
 */
function declaredSize(bytes: Uint8Array): number {
  if (bytes.length < 4) return 0
  const n = bytes.length
  return (
    (bytes[n - 4]! | (bytes[n - 3]! << 8) | (bytes[n - 2]! << 16) | (bytes[n - 1]! << 24)) >>> 0
  )
}

export function decodeLedger(code: string): ParseResult | ParseFailure {
  const trimmed = code.trim().replace(/\s+/g, '')
  if (trimmed === '') return { ok: false, message: 'Nothing to import.' }
  if (trimmed.length > MAX_COMPRESSED_CHARS) {
    return { ok: false, message: 'That share code is far too large to be a trip.' }
  }
  try {
    const packed = fromBase64Url(trimmed)
    if (declaredSize(packed) > MAX_DECOMPRESSED_BYTES) {
      return { ok: false, message: 'That share code unpacks to far more data than a trip needs.' }
    }
    const bytes = gunzipSync(packed)
    return parseLedger(JSON.parse(strFromU8(bytes)))
  } catch {
    return {
      ok: false,
      message: 'That share code is not readable — it may have been cut short when pasted.',
    }
  }
}

export function buildLedgerFile(trips: Record<Id, Trip>, deviceId: Id): LedgerFile {
  return {
    kind: 'tripsplit.ledger',
    schema: SCHEMA_VERSION,
    exportedAt: Date.now(),
    exportedBy: deviceId,
    trips,
  }
}
