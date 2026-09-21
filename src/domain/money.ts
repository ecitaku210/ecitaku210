import type { Currency, Minor } from './types'

/**
 * Largest safe amount, in minor units. At 2 decimals that is ~90 trillion
 * major units — far beyond any trip, and far below Number.MAX_SAFE_INTEGER
 * (9.007e15) even after the `amount * weight` multiply inside splitting.
 */
export const MAX_MINOR = 1_000_000_000_000

export function isValidMinor(n: unknown): n is Minor {
  return (
    typeof n === 'number' &&
    Number.isSafeInteger(n) &&
    Math.abs(n) <= MAX_MINOR
  )
}

/**
 * Parse user input ("1,234.5", "₹80", "12") into minor units.
 * Returns null on anything it cannot read exactly — never a guess, because a
 * silently misread amount is worse than a rejected one.
 *
 * Parsing is done on the STRING, not via parseFloat, so `0.07` becomes exactly
 * 7 and not 6 (which `Math.round(0.07 * 100)` can produce on other inputs).
 */
export function parseAmount(input: string, decimals: number): Minor | null {
  const cleaned = input.replace(/[\s, ]/g, '').replace(/^[^\d.-]+/, '')
  if (cleaned === '' || cleaned === '-') return null

  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (!m) return null

  const sign = m[1] === '-' ? -1 : 1
  const whole = m[2] ?? ''
  const frac = m[3] ?? ''
  if (whole === '' && frac === '') return null
  // More precision than the currency has is a typo, not a rounding request.
  if (frac.length > decimals) return null

  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  const value = sign * Number(`${whole || '0'}${padded}`)
  return isValidMinor(value) ? value : null
}

/**
 * Insert thousands separators. Done by hand rather than with
 * `toLocaleString` on purpose: that follows the *device* locale, so a German
 * phone would render 1200.50 as "1.200" + "." + "50" = "1.200.50". Worse,
 * `parseAmount` expects `,` grouping and a `.` decimal point, so a
 * locale-formatted string would not survive a round trip. A shared ledger
 * has to read the same on every phone in the group.
 */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Render minor units as a plain decimal string, no symbol. `1235` -> `12.35`. */
export function formatMinor(amount: Minor, decimals: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount).toString().padStart(decimals + 1, '0')
  if (decimals === 0) return sign + group(abs)
  const whole = abs.slice(0, -decimals)
  const frac = abs.slice(-decimals)
  return `${sign}${group(whole)}.${frac}`
}

/** Render with the trip's symbol, e.g. `₹1,234.50`. */
export function formatMoney(amount: Minor, currency: Currency): string {
  const body = formatMinor(Math.abs(amount), currency.decimals)
  return `${amount < 0 ? '-' : ''}${currency.symbol}${body}`
}

export const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'INR', symbol: '₹', decimals: 2 },
  { code: 'USD', symbol: '$', decimals: 2 },
  { code: 'EUR', symbol: '€', decimals: 2 },
  { code: 'GBP', symbol: '£', decimals: 2 },
  { code: 'AED', symbol: 'AED ', decimals: 2 },
  { code: 'SAR', symbol: 'SAR ', decimals: 2 },
  { code: 'JPY', symbol: '¥', decimals: 0 },
  { code: 'THB', symbol: '฿', decimals: 2 },
  { code: 'SGD', symbol: 'S$', decimals: 2 },
  { code: 'AUD', symbol: 'A$', decimals: 2 },
]
