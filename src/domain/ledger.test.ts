import { describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import { buildLedgerFile, decodeLedger, encodeLedger, parseLedger } from './ledger'
import { makeExpense, makeMember, makeTrip, randomTrip } from './testkit'
import { parseAmount, formatMinor, formatMoney } from './money'
import { SCHEMA_VERSION } from './types'

describe('parseAmount', () => {
  it.each([
    ['12', 2, 1200],
    ['12.3', 2, 1230],
    ['12.35', 2, 1235],
    ['0.07', 2, 7],
    ['1,234.50', 2, 123_450],
    ['₹80', 2, 8000],
    ['  42  ', 2, 4200],
    ['.5', 2, 50],
    ['1200', 0, 1200], // JPY, no minor unit
  ])('reads %s as %i minor units', (input, decimals, expected) => {
    expect(parseAmount(input, decimals)).toBe(expected)
  })

  it.each([
    ['', 2],
    ['abc', 2],
    ['12.345', 2], // more precision than the currency has is a typo
    ['1.5', 0],
    ['1.2.3', 2],
    ['-', 2],
  ])('refuses %s rather than guessing', (input, decimals) => {
    expect(parseAmount(input, decimals)).toBeNull()
  })

  it('parses from the string, dodging float error', () => {
    // Math.round(1.005 * 100) is 100, not 101, because 1.005 is really
    // 1.00499999999999989. String parsing gets it right.
    expect(parseAmount('1.005', 3)).toBe(1005)
    expect(parseAmount('8.87', 2)).toBe(887)
  })
})

describe('formatting', () => {
  it.each([
    [1235, 2, '12.35'],
    [7, 2, '0.07'],
    [0, 2, '0.00'],
    [-1235, 2, '-12.35'],
    [1200, 0, '1,200'],
  ])('renders %i as %s', (minor, decimals, expected) => {
    expect(formatMinor(minor, decimals)).toBe(expected)
  })

  it('round-trips through parse and format', () => {
    for (let v = 0; v < 2000; v += 7) {
      expect(parseAmount(formatMinor(v, 2).replace(/,/g, ''), 2)).toBe(v)
    }
  })

  it('puts the minus sign before the symbol, not after it', () => {
    expect(formatMoney(-1235, { code: 'INR', symbol: '₹', decimals: 2 })).toBe('-₹12.35')
  })
})

describe('encode / decode round trip', () => {
  it('survives a realistic ledger unchanged', () => {
    const trip = randomTrip(3, 6, 60)
    const file = buildLedgerFile({ [trip.id]: trip }, 'devA')
    const decoded = decodeLedger(encodeLedger(file))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.file.trips[trip.id]).toEqual(trip)
  })

  it('compresses enough to be pasteable', () => {
    const trip = randomTrip(4, 5, 50)
    const file = buildLedgerFile({ [trip.id]: trip }, 'devA')
    const code = encodeLedger(file)
    expect(code.length).toBeLessThan(JSON.stringify(file).length / 2)
  })

  it('tolerates the whitespace a chat app inserts when the code wraps', () => {
    const trip = makeTrip('t', [makeMember('m1', 'Asha')])
    const code = encodeLedger(buildLedgerFile({ t: trip }, 'devA'))
    const mangled = code.replace(/(.{40})/g, '$1\n  ')
    expect(decodeLedger(mangled).ok).toBe(true)
  })

  it.each([['not-base64!!'], ['aGVsbG8'], ['']])('rejects the junk %s', (junk) => {
    expect(decodeLedger(junk).ok).toBe(false)
  })

  it('refuses a decompression bomb by reading the gzip size footer first', () => {
    // 200 MB of zeros compresses to a few hundred bytes. Without the ISIZE
    // check this would be allocated in full before anything noticed.
    const bomb = gzipSync(new Uint8Array(200 * 1024 * 1024), { level: 9 })
    const b64 = Buffer.from(bomb)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const r = decodeLedger(b64)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('far more data')
  })

  it('refuses an absurdly long code before decoding it at all', () => {
    const r = decodeLedger('A'.repeat(9 * 1024 * 1024))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('too large')
  })
})

describe('parseLedger — untrusted input', () => {
  const goodTrip = () => {
    const t = makeTrip('t1', [makeMember('m1', 'Asha')])
    t.expenses.e1 = makeExpense({ id: 'e1', paidBy: 'm1', parts: [{ memberId: 'm1', weight: 1 }] })
    return t
  }
  const wrap = (trips: unknown) => ({
    kind: 'tripsplit.ledger',
    schema: SCHEMA_VERSION,
    exportedAt: 1,
    exportedBy: 'devA',
    trips,
  })

  it('accepts a well-formed ledger', () => {
    const r = parseLedger(wrap({ t1: goodTrip() }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })

  it.each([
    ['a plain object', {}],
    ['a string', 'hello'],
    ['null', null],
    ['the wrong kind', { kind: 'something.else', schema: 1, trips: {} }],
    ['no trips at all', wrap({})],
  ])('rejects %s', (_label, input) => {
    expect(parseLedger(input).ok).toBe(false)
  })

  it('refuses a ledger from a newer app version instead of mangling it', () => {
    const r = parseLedger({ ...wrap({ t1: goodTrip() }), schema: SCHEMA_VERSION + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('newer version')
  })

  it('drops one bad expense but keeps the rest of the trip, and says so', () => {
    const t = goodTrip()
    ;(t.expenses as Record<string, unknown>).evil = { id: 'evil', amountMinor: 'lots' }
    const r = parseLedger(wrap({ t1: t }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.file.trips.t1!.expenses)).toEqual(['e1'])
    expect(r.warnings.join(' ')).toContain('Skipped 1')
  })

  it.each([
    ['a negative amount', { amountMinor: -500 }],
    ['a fractional amount', { amountMinor: 10.5 }],
    ['an absurd amount', { amountMinor: 1e18 }],
    ['a bad date', { date: '31/01/2026' }],
    ['an unknown split mode', { splitMode: 'vibes' }],
    ['no participants', { parts: [] }],
    ['a fractional weight', { parts: [{ memberId: 'm1', weight: 0.5 }] }],
    ['a missing tombstone field', { deletedAt: 'no' }],
  ])('drops an expense with %s, keeping the trip', (_label, patch) => {
    // The trip itself is still readable, so it is kept — throwing away four
    // good days of expenses because one record is corrupt would be worse.
    const t = goodTrip()
    ;(t.expenses as Record<string, unknown>).e1 = { ...t.expenses.e1, ...patch }
    const r = parseLedger(wrap({ t1: t }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file.trips.t1!.expenses).toEqual({})
    expect(r.warnings.join(' ')).toContain('Skipped 1')
  })

  it('strips fields it does not know about rather than storing them', () => {
    const t = goodTrip()
    ;(t.expenses.e1 as unknown as Record<string, unknown>).surprise = { deeply: 'nested' }
    const r = parseLedger(wrap({ t1: t }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.trips.t1!.expenses.e1).not.toHaveProperty('surprise')
  })

  it('does not let an id smuggle in path or script characters', () => {
    const t = goodTrip()
    ;(t.expenses.e1 as unknown as Record<string, unknown>).id = '../../<script>'
    const r = parseLedger(wrap({ t1: t }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.trips.t1!.expenses).toEqual({})
  })

  it('refuses an id of __proto__ instead of reassigning a prototype', () => {
    // JSON.parse creates `__proto__` as a real own property, so without this
    // guard `expenses[id] = record` would swap the map's prototype: the
    // record vanishes from Object.values while its fields leak into every
    // lookup on that map.
    const t = goodTrip()
    ;(t.expenses as Record<string, unknown>).e1 = { ...t.expenses.e1, id: '__proto__' }
    const r = parseLedger(JSON.parse(JSON.stringify(wrap({ t1: t }))))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const expenses = r.file.trips.t1!.expenses
    expect(expenses).toEqual({})
    expect(Object.getPrototypeOf(expenses)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).amountMinor).toBeUndefined()
  })

  it('truncates an absurdly long name instead of storing it', () => {
    const t = goodTrip()
    t.name = 'x'.repeat(5000)
    const r = parseLedger(wrap({ t1: t }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.trips.t1!.name.length).toBeLessThanOrEqual(120)
  })
})

describe('parseLedger — date handling', () => {
  const wrapTrip = (patch: Record<string, unknown>) => {
    const t = makeTrip('t1', [makeMember('m1', 'Asha')])
    t.expenses.e1 = makeExpense({ id: 'e1', paidBy: 'm1', parts: [{ memberId: 'm1', weight: 1 }] })
    ;(t.expenses as Record<string, unknown>).e1 = { ...t.expenses.e1, ...patch }
    return {
      kind: 'tripsplit.ledger',
      schema: SCHEMA_VERSION,
      exportedAt: 1,
      exportedBy: 'devA',
      trips: { t1: t },
    }
  }

  it.each([
    ['2026-01-0199', 'a date with trailing junk'],
    ['2026-02-30', 'a day that does not exist'],
    ['2026-13-01', 'a month that does not exist'],
    ['2026-00-10', 'month zero'],
    ['26-01-01', 'a two-digit year'],
    ['31/01/2026', 'the wrong format entirely'],
  ])('rejects %s (%s) instead of silently repairing it', (date) => {
    // The old code ran dates through a 10-character truncation, so
    // "2026-01-0199" became "2026-01-01" and passed as valid.
    const r = parseLedger(wrapTrip({ date }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.trips.t1!.expenses).toEqual({})
  })

  it('accepts a real leap day', () => {
    const r = parseLedger(wrapTrip({ date: '2028-02-29' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.trips.t1!.expenses.e1?.date).toBe('2028-02-29')
  })

  it('rejects a leap day in a non-leap year', () => {
    const r = parseLedger(wrapTrip({ date: '2026-02-29' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.trips.t1!.expenses).toEqual({})
  })
})
