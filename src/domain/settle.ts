import type { Id, Minor } from './types'
import type { MemberBalance } from './balance'

export interface Transfer {
  fromMember: Id
  toMember: Id
  amountMinor: Minor
}

/**
 * Turn a table of net balances into a short list of "A pays B ₹X".
 *
 * WHY NOT JUST "EVERYONE PAYS EVERYONE": with 6 people the naive pairwise
 * ledger is 15 transfers. Netting first collapses that to at most 5.
 *
 * THE ALGORITHM: greedy largest-debtor-to-largest-creditor. Repeatedly take
 * the person most in debt and the person most owed, and move the smaller of
 * the two amounts. Each step zeroes at least one person, so it terminates in
 * at most n-1 transfers.
 *
 * HONEST CAVEAT: this is not guaranteed to be the theoretical *minimum*
 * number of transfers — that problem (subset-sum in disguise) is NP-hard.
 * Greedy is optimal whenever no proper subgroup happens to net to zero, which
 * is essentially always with real trip amounts, and never worse than n-1.
 *
 * DETERMINISM: ties break on member id so every phone renders the same plan.
 */
export function settlementPlan(balances: MemberBalance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.netMinor > 0)
    .map((b) => ({ id: b.memberId, amount: b.netMinor }))
  const debtors = balances
    .filter((b) => b.netMinor < 0)
    .map((b) => ({ id: b.memberId, amount: -b.netMinor }))

  const byAmountThenId = (a: { id: Id; amount: Minor }, b: { id: Id; amount: Minor }) =>
    b.amount - a.amount || (a.id < b.id ? -1 : 1)

  creditors.sort(byAmountThenId)
  debtors.sort(byAmountThenId)

  const transfers: Transfer[] = []
  let ci = 0
  let di = 0

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!
    const debtor = debtors[di]!
    const amount = Math.min(creditor.amount, debtor.amount)

    if (amount > 0) {
      transfers.push({ fromMember: debtor.id, toMember: creditor.id, amountMinor: amount })
    }

    creditor.amount -= amount
    debtor.amount -= amount
    if (creditor.amount === 0) ci += 1
    if (debtor.amount === 0) di += 1
  }

  return transfers
}
