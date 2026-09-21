import { useMemo, useState } from 'react'
import { todayISO, useStore, useTrip } from '../../storage/store'
import { liveMembers } from '../../domain/balance'
import { computeSplit, PERCENT_TOTAL } from '../../domain/split'
import { formatMinor, parseAmount } from '../../domain/money'
import { Avatar, Field, Money, Segmented, TopBar } from '../components'
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
  const members = trip ? liveMembers(trip) : []
  const decimals = trip?.currency.decimals ?? 2

  const [description, setDescription] = useState(existing?.description ?? '')
  const [amountText, setAmountText] = useState(
    existing ? formatMinor(existing.amountMinor, decimals).replace(/,/g, '') : '',
  )
  const [paidBy, setPaidBy] = useState<Id>(
    existing?.paidBy ?? db.identities[tripId] ?? members[0]?.id ?? '',
  )
  const [date, setDate] = useState(existing?.date ?? todayISO())
  const [mode, setMode] = useState<SplitMode>(existing?.splitMode ?? 'equal')
  const [note, setNote] = useState(existing?.note ?? '')

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
      const raw = weights[m.id] ?? ''
      if (mode === 'equal') return { memberId: m.id, weight: 1 }
      if (mode === 'exact') return { memberId: m.id, weight: parseAmount(raw, decimals) ?? -1 }
      if (mode === 'percent') {
        // Store basis points so 33.33% is exact rather than a rounded float.
        const bp = parseAmount(raw, 2)
        return { memberId: m.id, weight: bp ?? -1 }
      }
      const n = Number(raw === '' ? '1' : raw)
      return { memberId: m.id, weight: Number.isInteger(n) ? n : -1 }
    })
  }, [members, included, weights, mode, decimals])

  const split = useMemo(() => {
    if (amountMinor === null) return null
    return computeSplit(amountMinor, mode, parts)
  }, [amountMinor, mode, parts])

  if (!trip) {
    return (
      <>
        <TopBar title="Trip not found" onBack />
      </>
    )
  }

  const amountProblem =
    amountText.trim() === ''
      ? 'Enter an amount.'
      : amountMinor === null
        ? `That is not an amount this currency can hold (max ${decimals} decimal places).`
        : amountMinor <= 0
          ? 'Amount must be more than zero.'
          : null

  const problem = amountProblem ?? (split && !split.ok ? split.message : null)
  const canSave = problem === null && paidBy !== '' && description.trim() !== ''

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

  const percentTotal = parts.reduce((a, p) => a + Math.max(p.weight, 0), 0)

  return (
    <>
      <TopBar title={existing ? 'Edit expense' : 'Add expense'} onBack />
      <div className="content">
        <Field label={`Amount (${trip.currency.code})`}>
          <input
            className="amount-input num"
            // `decimal` gives the numeric keypad with a decimal point on iOS
            // and Android, without the spinner arrows `type=number` adds.
            inputMode="decimal"
            autoFocus={!existing}
            value={amountText}
            placeholder="0"
            onChange={(e) => setAmountText(e.target.value)}
          />
        </Field>

        <Field label="What was it for?">
          <input
            value={description}
            placeholder="Dinner at the beach shack"
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field label="Who paid?">
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === db.identities[tripId] ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Split">
          <Segmented value={mode} options={MODE_OPTIONS} onChange={setMode} />
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
                    onChange={() =>
                      setIncluded((prev) => {
                        const next = new Set(prev)
                        if (next.has(m.id)) next.delete(m.id)
                        else next.add(m.id)
                        return next
                      })
                    }
                  />
                  <Avatar member={m} small />
                  <span className="name">{m.name}</span>
                  {on && mode !== 'equal' && (
                    <input
                      inputMode="decimal"
                      className="num"
                      value={weights[m.id] ?? ''}
                      placeholder={mode === 'shares' ? '1' : '0'}
                      onChange={(e) =>
                        setWeights((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
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
              Adds up to {(percentTotal / 100).toFixed(2)}% of {PERCENT_TOTAL / 100}%.
            </p>
          )}
          {mode === 'shares' && (
            <p className="hint">
              Whole numbers. Give a couple sharing one room 2 and everyone else 1.
            </p>
          )}
          {mode === 'exact' && amountMinor !== null && (
            <p className="hint">
              Must add up to exactly{' '}
              <Money amount={amountMinor} currency={trip.currency} />.
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

        {problem && <div className="error">{problem}</div>}

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
