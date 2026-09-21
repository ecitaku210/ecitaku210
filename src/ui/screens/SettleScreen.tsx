import { useState } from 'react'
import { todayISO, useStore, useTrip } from '../../storage/store'
import { computeTotals } from '../../domain/balance'
import { settlementPlan } from '../../domain/settle'
import { formatMinor, parseAmount } from '../../domain/money'
import { Empty, Money, TopBar } from '../components'
import { navigate } from '../router'
import type { Id } from '../../domain/types'

export function SettleScreen({ tripId }: { tripId: Id }) {
  const trip = useTrip(tripId)
  const { addSettlement } = useStore()
  const [recorded, setRecorded] = useState<Set<string>>(new Set())

  if (!trip) return <TopBar title="Trip not found" onBack />

  const totals = computeTotals(trip)
  const plan = settlementPlan(totals.balances)
  const nameOf = (id: Id) => trip.members[id]?.name ?? 'Someone (removed)'

  return (
    <>
      <TopBar title="Settle up" subtitle={trip.name} onBack />
      <div className="content">
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
                {plan.map((t) => {
                  const key = `${t.fromMember}>${t.toMember}:${t.amountMinor}`
                  const done = recorded.has(key)
                  return (
                    <div key={key} className="row" style={{ cursor: 'default' }}>
                      <div className="grow">
                        <div className="title">
                          {nameOf(t.fromMember)} → {nameOf(t.toMember)}
                        </div>
                        <div className="meta">
                          {done ? 'Recorded as paid' : 'Tap Record once the money has moved'}
                        </div>
                      </div>
                      <div className="amount">
                        <Money amount={t.amountMinor} currency={trip.currency} />
                      </div>
                      <button
                        className="btn icon"
                        disabled={done}
                        onClick={() => {
                          addSettlement(tripId, {
                            fromMember: t.fromMember,
                            toMember: t.toMember,
                            amountMinor: t.amountMinor,
                            date: todayISO(),
                            note: 'Settle up',
                          })
                          setRecorded((prev) => new Set(prev).add(key))
                        }}
                      >
                        {done ? '✓' : 'Record'}
                      </button>
                    </div>
                  )
                })}
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
        <button className="btn block" onClick={() => navigate(`/trip/${tripId}`)}>
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
  const members = trip ? Object.values(trip.members).filter((m) => m.deletedAt === null) : []
  const [from, setFrom] = useState(members[0]?.id ?? '')
  const [to, setTo] = useState(members[1]?.id ?? '')
  const [amount, setAmount] = useState('')

  if (!trip) return null
  const decimals = trip.currency.decimals
  const minor = amount.trim() === '' ? null : parseAmount(amount, decimals)
  const valid = from !== '' && to !== '' && from !== to && minor !== null && minor > 0

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
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Who received</label>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
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
      {from === to && <div className="error">Pick two different people.</div>}
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
              fromMember: from,
              toMember: to,
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

