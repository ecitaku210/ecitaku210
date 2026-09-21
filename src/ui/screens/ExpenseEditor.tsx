import { useMemo, useState } from 'react'
import { todayISO, useStore, useTrip } from '../../storage/store'
import { liveMembers } from '../../domain/balance'
import { computeSplit, PERCENT_TOTAL } from '../../domain/split'
import { formatMinor, parseAmount } from '../../domain/money'
import { Avatar, Field, Money, NotFound, Segmented, TopBar } from '../components'
import { back, navigate } from '../router'
import type { Id, SplitMode } from '../../domain/types'

const MODE_OPTIONS: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Amounts' },
  { value: 'shares', label: 'Shares' },
  { value: 'percent', label: '%' },
]

export function ExpenseEditor({ tripId, expenseId }: { tripId: Id; expenseId: Id | null }) {
  const trip = useTrip(tripId)
  const { db, saveExpense, deleteExpense } = useStore()
  const existing = expenseId && trip ? trip.expenses[expenseId] : undefined
  const decimals = trip?.currency.decimals ?? 2

  /**
   * Live members, PLUS anyone already in this expense who has since been
   * removed from the trip.
   *
   * Without that second group, opening an old expense to fix a typo would
   * quietly drop the removed person's share, and everyone still on the trip
   * would silently absorb their portion. An edit must never change money the
   * user did not touch.
   */
  const members = useMemo(() => {
    if (!trip) return []
    const live = liveMembers(trip)
    if (!existing) return live
    const shown = new Set(live.map((m) => m.id))
    const departed = existing.parts
      .map((p) => trip.members[p.memberId])
      .filter((m): m is NonNullable<typeof m> => !!m && !shown.has(m.id))
    const payer = trip.members[existing.paidBy]
    if (payer && !shown.has(payer.id) && !departed.some((m) => m.id === payer.id)) {
      departed.push(payer)
    }
    return [...live, ...departed]
  }, [trip, existing])

  const [description, setDescription] = useState(existing?.description ?? '')
  const [amountText, setAmountText] = useState(
    existing ? formatMinor(existing.amountMinor, decimals).replace(/,/g, '') : '',
  )
  const [paidBy, setPaidBy] = useState<Id>(() => {
    if (existing) return existing.paidBy
    // Only default to "me" if that member actually exists on this trip. A
    // stale identity would otherwise leave the select showing one name while
    // the state held another, and the expense would save against the wrong
    // person without the user ever seeing it.
    const me = db.identities[tripId]
    if (me && members.some((m) => m.id === me)) return me
    return members[0]?.id ?? ''
  })
  const [date, setDate] = useState(existing?.date ?? todayISO())
  const [mode, setMode] = useState<SplitMode>(existing?.splitMode ?? 'equal')
  const [note, setNote] = useState(existing?.note ?? '')
  const [touched, setTouched] = useState(false)

  const [included, setIncluded] = useState<Set<Id>>(
    () =>
      new Set(existing ? existing.parts.map((p) => p.memberId) : members.map((m) => m.id)),
  )
  /** Raw text per member for exact/shares/percent, kept as typed. */
  const [weights, setWeights] = useState<Record<Id, string>>(() => {
    if (!existing) return {}
    const out: Record<Id, string> = {}
    for (const p of existing.parts) {
      out[p.memberId] =
        existing.splitMode === 'exact'
          ? formatMinor(p.weight, decimals).replace(/,/g, '')
          : existing.splitMode === 'percent'
            ? String(p.weight / 100)
            : String(p.weight)
    }
    return out
  })

  const amountMinor = parseAmount(amountText, decimals)

  const parts = useMemo(() => {
    const chosen = members.filter((m) => included.has(m.id))
    return chosen.map((m) => {
      const raw = (weights[m.id] ?? '').trim()
      if (mode === 'equal') return { memberId: m.id, weight: 1 }
      // An empty box means "nothing", not "invalid". Sending -1 here made the
      // form complain about non-numbers the moment it opened, before the user
      // had typed anything at all.
      if (mode === 'exact') {
        return { memberId: m.id, weight: raw === '' ? 0 : (parseAmount(raw, decimals) ?? -1) }
      }
      if (mode === 'percent') {
        // Basis points, so 33.33% is exact rather than a rounded float.
        return { memberId: m.id, weight: raw === '' ? 0 : (parseAmount(raw, 2) ?? -1) }
      }
      // Shares default to 1: the common case is "everyone one share".
      const n = Number(raw === '' ? '1' : raw)
      return { memberId: m.id, weight: Number.isInteger(n) ? n : -1 }
    })
  }, [members, included, weights, mode, decimals])

  const split = useMemo(() => {
    if (amountMinor === null) return null
    return computeSplit(amountMinor, mode, parts)
  }, [amountMinor, mode, parts])

  if (!trip) return <NotFound what="trip" />
  // An expense id in the URL that this phone has never seen, or that was
  // deleted, must say so rather than silently opening a blank "new expense".
  if (expenseId && !existing) return <NotFound what="expense" />

  const problem =
    amountText.trim() === ''
      ? 'Enter an amount.'
      : amountMinor === null
        ? `That is not an amount this currency can hold (max ${decimals} decimal places).`
        : amountMinor <= 0
          ? 'Amount must be more than zero.'
          : split && !split.ok
            ? split.message
            : description.trim() === ''
              ? 'Add a short description so everyone knows what this was.'
              : members.length === 0
                ? 'Add someone to the trip before logging an expense.'
                : paidBy === ''
                  ? 'Pick who paid.'
                  : null

  const canSave = problem === null

  /**
   * A blank new form is not a mistake the user has made yet, so it should not
   * greet them in red. The message appears once they have touched something,
   * or immediately when editing an expense that is already broken.
   */
  const showProblem = problem !== null && (touched || existing !== undefined)

  function save() {
    if (!canSave || amountMinor === null) return
    saveExpense(tripId, {
      ...(expenseId ? { id: expenseId } : {}),
      description: description.trim(),
      amountMinor,
      paidBy,
      date,
      splitMode: mode,
      parts,
      note: note.trim(),
    })
    navigate(`/trip/${tripId}`)
  }

  /**
   * The sum of whatever the user has typed into the per-person boxes. What it
   * means depends on the mode: basis points under `percent`, minor units under
   * `exact`. Negative entries (a box that cannot be parsed) are floored at
   * zero so the running total does not read as nonsense mid-typing.
   */
  const enteredTotal = parts.reduce((a, p) => a + Math.max(p.weight, 0), 0)

  return (
    <>
      <TopBar title={existing ? 'Edit expense' : 'Add expense'} onBack />
      <div className="content no-fab">
        <Field label={`Amount (${trip.currency.code})`}>
          <input
            className="amount-input num"
            // `decimal` gives the numeric keypad with a decimal point on iOS
            // and Android, without the spinner arrows `type=number` adds.
            inputMode="decimal"
            autoFocus={!existing}
            value={amountText}
            placeholder="0"
            onChange={(e) => {
              setAmountText(e.target.value)
              setTouched(true)
            }}
          />
        </Field>

        <Field label="What was it for?">
          <input
            value={description}
            placeholder="Dinner at the beach shack"
            maxLength={200}
            onChange={(e) => {
              setDescription(e.target.value)
              setTouched(true)
            }}
          />
        </Field>

        <Field label="Who paid?">
          <select
            value={paidBy}
            onChange={(e) => {
              setPaidBy(e.target.value)
              setTouched(true)
            }}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === db.identities[tripId] ? ' (you)' : ''}
                {m.deletedAt !== null ? ' — no longer on the trip' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Split">
          <Segmented
            value={mode}
            options={MODE_OPTIONS}
            onChange={(next) => {
              // Numbers do not survive a mode change: shares of 2/1/1 read as
              // basis points is 0.04%, which surfaces as a baffling error.
              if (next !== mode) setWeights({})
              setMode(next)
              setTouched(true)
            }}
          />
        </Field>

        <div className="section">
          <div className="card">
            {members.map((m) => {
              const on = included.has(m.id)
              return (
                <div key={m.id} className="split-row">
                  <input
                    className="check"
                    type="checkbox"
                    checked={on}
                    aria-label={`Include ${m.name}`}
                    onChange={() => {
                      setTouched(true)
                      setIncluded((prev) => {
                        const next = new Set(prev)
                        if (next.has(m.id)) next.delete(m.id)
                        else next.add(m.id)
                        return next
                      })
                    }}
                  />
                  <Avatar member={m} small />
                  <span className="name">
                    {m.name}
                    {m.deletedAt !== null && <> <span className="chip tiny">removed</span></>}
                  </span>
                  {on && mode !== 'equal' && (
                    <input
                      inputMode="decimal"
                      className="num"
                      value={weights[m.id] ?? ''}
                      placeholder={mode === 'shares' ? '1' : '0'}
                      onChange={(e) => {
                        setTouched(true)
                        setWeights((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }}
                    />
                  )}
                  {on && split?.ok && (
                    <span className="num share-preview">
                      <Money amount={split.shares.get(m.id) ?? 0} currency={trip.currency} />
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {mode === 'percent' && (
            <p className="hint">
              Adds up to {(enteredTotal / 100).toFixed(2)}% of {PERCENT_TOTAL / 100}%.
            </p>
          )}
          {mode === 'shares' && (
            <p className="hint">
              Whole numbers. Give a couple sharing one room 2 and everyone else 1.
            </p>
          )}
          {mode === 'exact' && amountMinor !== null && (
            /*
             * A live running total, formatted as money. The split code cannot
             * produce this itself — it has no currency, so its message would
             * have to print raw minor units ("adds up to 10000"), which is
             * internal representation leaking onto a user's screen.
             */
            <p className="hint">
              Allocated <Money amount={enteredTotal} currency={trip.currency} /> of{' '}
              <Money amount={amountMinor} currency={trip.currency} />
              {enteredTotal !== amountMinor && (
                <>
                  {' — '}
                  <strong>
                    <Money
                      amount={Math.abs(amountMinor - enteredTotal)}
                      currency={trip.currency}
                    />{' '}
                    {enteredTotal < amountMinor ? 'still to assign' : 'over'}
                  </strong>
                </>
              )}
            </p>
          )}
        </div>

        <Field label="Note (optional)">
          <textarea
            value={note}
            maxLength={500}
            placeholder="Anything worth remembering about this one"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {showProblem && <div className="error">{problem}</div>}

        <div className="spacer" />
        <div className="btn-row">
          <button className="btn ghost" onClick={back}>
            Cancel
          </button>
          <button className="btn primary" disabled={!canSave} onClick={save}>
            Save
          </button>
        </div>

        {existing && (
          <>
            <div className="spacer" />
            <button
              className="btn danger block"
              onClick={() => {
                // A tombstone, not a removal — see merge.ts. Deleting the
                // record outright would let a friend's stale file resurrect it.
                if (confirm('Delete this expense? Everyone you sync with will see it removed.')) {
                  deleteExpense(tripId, existing.id)
                  navigate(`/trip/${tripId}`)
                }
              }}
            >
              Delete expense
            </button>
          </>
        )}
      </div>
    </>
  )
}
