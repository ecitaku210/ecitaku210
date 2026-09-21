import { useMemo, useState } from 'react'
import { todayISO, useStore, useTrip } from '../../storage/store'
import { computeTotals, liveMembers } from '../../domain/balance'
import { settlementPlan } from '../../domain/settle'
import { formatMinor, parseAmount } from '../../domain/money'
import { Empty, Money, NotFound, TopBar } from '../components'
import { navigate } from '../router'
import type { Id, Minor } from '../../domain/types'

interface Recorded {
  fromName: string
  toName: string
  amountMinor: Minor
}

export function SettleScreen({ tripId }: { tripId: Id }) {
  const trip = useTrip(tripId)
  const { addSettlement } = useStore()
  /**
   * Recording a payment changes the balances, so that transfer immediately
   * drops out of the plan below. Without this list the row would simply
   * vanish under the user's thumb with no confirmation that anything
   * happened — so the receipt is kept here and shown back to them.
   */
  const [recorded, setRecorded] = useState<Recorded[]>([])

  const totals = useMemo(() => (trip ? computeTotals(trip) : null), [trip])
  const plan = useMemo(() => (totals ? settlementPlan(totals.balances) : []), [totals])

  if (!trip) return <NotFound what="trip" />

  const nameOf = (id: Id) => trip.members[id]?.name ?? 'Someone (removed)'

  return (
    <>
      <TopBar title="Settle up" subtitle={trip.name} onBack />
      <div className="content no-fab">
        {recorded.length > 0 && (
          <div className="section">
            <div className="notice good">
              <strong>Recorded on this phone:</strong>
              {recorded.map((r, i) => (
                <div key={i}>
                  {r.fromName} → {r.toName} ·{' '}
                  <Money amount={r.amountMinor} currency={trip.currency} />
                </div>
              ))}
              <div className="spacer" />
              Share the trip so everyone else sees these too.
            </div>
          </div>
        )}

        {plan.length === 0 ? (
          <Empty title="Nothing to settle">
            Everyone on this phone&apos;s copy is square. Sync with the group first to be sure
            nothing is missing.
          </Empty>
        ) : (
          <>
            <div className="section">
              <div className="notice">
                <strong>
                  {plan.length} payment{plan.length > 1 ? 's' : ''} clears the whole group.
                </strong>{' '}
                Instead of everyone paying everyone, the debts are netted off first.
              </div>
            </div>

            <div className="section">
              <h2>Who pays whom</h2>
              <div className="card">
                {plan.map((t) => (
                  <div
                    key={`${t.fromMember}>${t.toMember}`}
                    className="row"
                    style={{ cursor: 'default' }}
                  >
                    <div className="grow">
                      <div className="title">
                        {nameOf(t.fromMember)} → {nameOf(t.toMember)}
                      </div>
                      <div className="meta">Tap Record when the money has moved</div>
                    </div>
                    <div className="amount">
                      <Money amount={t.amountMinor} currency={trip.currency} />
                    </div>
                    <button
                      className="btn icon"
                      onClick={() => {
                        addSettlement(tripId, {
                          fromMember: t.fromMember,
                          toMember: t.toMember,
                          amountMinor: t.amountMinor,
                          date: todayISO(),
                          note: 'Settle up',
                        })
                        setRecorded((prev) => [
                          ...prev,
                          {
                            fromName: nameOf(t.fromMember),
                            toName: nameOf(t.toMember),
                            amountMinor: t.amountMinor,
                          },
                        ])
                      }}
                    >
                      Record
                    </button>
                  </div>
                ))}
              </div>
              <p className="hint">
                Recording a payment only changes <em>this</em> phone. Share the trip afterwards so
                everyone else sees it too.
              </p>
            </div>
          </>
        )}

        <ManualRepayment tripId={tripId} />

        <div className="spacer" />
        <button className="btn block ghost" onClick={() => navigate(`/trip/${tripId}`)}>
          Back to trip
        </button>
      </div>
    </>
  )
}

function ManualRepayment({ tripId }: { tripId: Id }) {
  const trip = useTrip(tripId)
  const { addSettlement } = useStore()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState<Id>('')
  const [to, setTo] = useState<Id>('')
  const [amount, setAmount] = useState('')

  // Sorted the same way as every other member list in the app, so the order
  // does not shuffle between screens.
  const members = useMemo(() => (trip ? liveMembers(trip) : []), [trip])

  if (!trip) return null
  const decimals = trip.currency.decimals
  const minor = amount.trim() === '' ? null : parseAmount(amount, decimals)

  // Resolved at render rather than in useState, because the member list is
  // not known on the very first render of a freshly imported trip.
  const fromId = from || members[0]?.id || ''
  const toId = to || members.find((m) => m.id !== fromId)?.id || ''
  const valid = fromId !== '' && toId !== '' && fromId !== toId && minor !== null && minor > 0

  if (!open) {
    return (
      <div className="section">
        <button className="btn block ghost" onClick={() => setOpen(true)}>
          Record a different repayment
        </button>
      </div>
    )
  }

  return (
    <div className="section">
      <h2>Record a repayment</h2>
      <div className="field">
        <label>Who paid</label>
        <select value={fromId} onChange={(e) => setFrom(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Who received</label>
        <select value={toId} onChange={(e) => setTo(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Amount ({trip.currency.code})</label>
        <input
          inputMode="decimal"
          className="num"
          value={amount}
          placeholder={formatMinor(0, decimals)}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      {fromId === toId && fromId !== '' && (
        <div className="error">Pick two different people.</div>
      )}
      {amount.trim() !== '' && minor === null && (
        <div className="error">That is not an amount this currency can hold.</div>
      )}
      <div className="btn-row">
        <button className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => {
            if (minor === null) return
            addSettlement(tripId, {
              fromMember: fromId,
              toMember: toId,
              amountMinor: minor,
              date: todayISO(),
              note: '',
            })
            setAmount('')
            setOpen(false)
          }}
        >
          Record
        </button>
      </div>
    </div>
  )
}
