import type { Id, Minor, SplitMode, SplitPart } from './types'
import { isValidMinor } from './money'

export interface SplitResult {
  ok: true
  /** memberId -> minor units owed. Guaranteed to sum to the expense total. */
  shares: Map<Id, Minor>
}
export interface SplitError {
  ok: false
  message: string
}

export const PERCENT_TOTAL = 10_000 // basis points; 100.00% == 10000

/**
 * Divide `amountMinor` across `parts`.
 *
 * THE INVARIANT: the returned shares always sum to exactly `amountMinor`.
 * A 100 rupee dinner split three ways is 3333 + 3333 + 3334 paise, never
 * 3333 x 3 (which loses a paisa) and never 33.34 x 3 (which invents one).
 *
 * THE METHOD: largest remainder. Give everyone their floored exact share,
 * then hand the leftover minor units one at a time to whoever was rounded
 * down hardest.
 *
 * THE TIE-BREAK MATTERS. Two phones must compute byte-identical shares for
 * the same expense or their ledgers disagree after a merge. So ties are
 * broken on `memberId`, which is a UUID and therefore gives a total order
 * that does not depend on object key order, locale, or insertion sequence.
 */
export function computeSplit(
  amountMinor: Minor,
  mode: SplitMode,
  parts: SplitPart[],
): SplitResult | SplitError {
  if (!isValidMinor(amountMinor)) {
    return { ok: false, message: 'Amount is not a valid whole minor-unit value.' }
  }
  if (amountMinor <= 0) {
    return { ok: false, message: 'Amount must be greater than zero.' }
  }
  if (parts.length === 0) {
    return { ok: false, message: 'Pick at least one person to split between.' }
  }

  const seen = new Set<Id>()
  for (const p of parts) {
    if (seen.has(p.memberId)) {
      return { ok: false, message: 'The same person appears twice in the split.' }
    }
    seen.add(p.memberId)
    if (!Number.isFinite(p.weight)) {
      return { ok: false, message: 'Split values must be numbers.' }
    }
  }

  if (mode === 'exact') return exactSplit(amountMinor, parts)

  const weights = parts.map((p) => (mode === 'equal' ? 1 : p.weight))

  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      return {
        ok: false,
        message:
          mode === 'percent'
            ? 'Percentages must be whole numbers of basis points.'
            : 'Shares must be whole numbers, zero or more.',
      }
    }
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight <= 0) {
    return { ok: false, message: 'At least one person needs a share above zero.' }
  }
  if (mode === 'percent' && totalWeight !== PERCENT_TOTAL) {
    return {
      ok: false,
      message: `Percentages must add up to 100%, not ${(totalWeight / 100).toFixed(2)}%.`,
    }
  }

  return { ok: true, shares: largestRemainder(amountMinor, parts, weights) }
}

/** In `exact` mode the weights are the amounts, so they must already balance. */
function exactSplit(amountMinor: Minor, parts: SplitPart[]): SplitResult | SplitError {
  let sum = 0
  for (const p of parts) {
    if (!Number.isSafeInteger(p.weight) || p.weight < 0) {
      return { ok: false, message: 'Each exact amount must be zero or more.' }
    }
    sum += p.weight
  }
  if (sum !== amountMinor) {
    return {
      ok: false,
      message: `Exact amounts add up to ${sum}, but the expense is ${amountMinor} (in minor units).`,
    }
  }
  const shares = new Map<Id, Minor>()
  for (const p of parts) shares.set(p.memberId, p.weight)
  return { ok: true, shares }
}

function largestRemainder(
  amountMinor: Minor,
  parts: SplitPart[],
  weights: number[],
): Map<Id, Minor> {
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  const rows = parts.map((p, i) => {
    const w = weights[i] ?? 0
    // Exact integer numerator; no division has happened yet, so no precision
    // has been lost at this point.
    const numerator = amountMinor * w
    const base = Math.floor(numerator / totalWeight)
    return { memberId: p.memberId, base, remainder: numerator - base * totalWeight }
  })

  let distributed = rows.reduce((a, r) => a + r.base, 0)
  let leftover = amountMinor - distributed

  // Biggest fractional part first; UUID ascending on a tie, so every replica
  // orders these identically.
  const order = [...rows].sort(
    (a, b) => b.remainder - a.remainder || (a.memberId < b.memberId ? -1 : 1),
  )

  const shares = new Map<Id, Minor>()
  for (const r of rows) shares.set(r.memberId, r.base)

  let i = 0
  while (leftover > 0 && order.length > 0) {
    const row = order[i % order.length]!
    shares.set(row.memberId, (shares.get(row.memberId) ?? 0) + 1)
    leftover -= 1
    i += 1
  }

  return shares
}

/** Convenience for the common case: everybody in, split evenly. */
export function equalParts(memberIds: Id[]): SplitPart[] {
  return memberIds.map((memberId) => ({ memberId, weight: 1 }))
}
