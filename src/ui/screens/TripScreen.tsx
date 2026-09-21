import { useMemo, useState } from 'react'
import { useStore, useTrip } from '../../storage/store'
import { computeTotals, liveExpenses, liveMembers, liveSettlements } from '../../domain/balance'
import { findProbableDuplicates } from '../../domain/merge'
import { Avatar, Empty, Money, NotFound, Segmented, TopBar, shortDate } from '../components'
import { navigate } from '../router'
import type { Id, Trip } from '../../domain/types'

type Tab = 'expenses' | 'balances'

export function TripScreen({ tripId }: { tripId: Id }) {
  const trip = useTrip(tripId)
  const [tab, setTab] = useState<Tab>('expenses')

  if (!trip) return <NotFound what="trip" />

  return (
    <>
      <TopBar
        title={trip.name}
        subtitle={`${liveMembers(trip).length} people`}
        onBack
        right={
          <button className="btn ghost icon" onClick={() => navigate(`/trip/${tripId}/people`)}>
            People
          </button>
        }
      />
      <div className="content">
        <div className="section">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'expenses', label: 'Expenses' },
              { value: 'balances', label: 'Balances' },
            ]}
          />
        </div>

        <IdentityPrompt trip={trip} />
        <Warnings trip={trip} />

        {tab === 'expenses' ? <ExpensesTab trip={trip} /> : <BalancesTab trip={trip} />}

        <div className="section">
          <div className="btn-row">
            <button className="btn" onClick={() => navigate(`/trip/${tripId}/share`)}>
              Share / sync
            </button>
            <button className="btn" onClick={() => navigate(`/trip/${tripId}/settle`)}>
              Settle up
            </button>
          </div>
        </div>
      </div>

      <button
        className="btn primary fab"
        onClick={() => navigate(`/trip/${tripId}/expense/new`)}
      >
        + Add expense
      </button>
    </>
  )
}

/**
 * After importing a trip there is no way for the app to know which member the
 * new phone belongs to. Left unasked, "Who paid?" silently defaults to
 * whoever sorts first alphabetically, so expenses get logged against the
 * wrong person — and the home screen shows a balance of zero. Asking once,
 * up front, is the only honest fix.
 */
function IdentityPrompt({ trip }: { trip: Trip }) {
  const { db, setMyself } = useStore()
  const members = liveMembers(trip)
  if (db.identities[trip.id] || members.length === 0) return null

  return (
    <div className="section">
      <div className="notice">
        <strong>Which one of these is you?</strong> Until you say, expenses will default to the
        wrong person and your balance will show as zero.
        <div className="spacer" />
        <select value="" onChange={(e) => e.target.value && setMyself(trip.id, e.target.value)}>
          <option value="">Choose your name…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

/** Things the user must see: broken records and likely double entries. */
function Warnings({ trip }: { trip: Trip }) {
  const totals = useMemo(() => computeTotals(trip), [trip])
  const duplicates = useMemo(() => findProbableDuplicates(trip), [trip])

  if (totals.problems.length === 0 && duplicates.length === 0) return null

  return (
    <div className="section">
      {totals.problems.length > 0 && (
        <div className="error">
          {totals.problems.length} expense(s) could not be added up and are being left out of every
          balance. Open and re-save them to fix.
        </div>
      )}
      {duplicates.length > 0 && (
        <div className="notice">
          <strong>
            {duplicates.length} possible double entry
            {duplicates.length > 1 ? ' groups' : ''}.
          </strong>{' '}
          Two phones logged the same amount, on the same day, paid by the same person. Check the
          expense list and delete whichever is the copy — nothing is removed automatically.
        </div>
      )}
    </div>
  )
}

function ExpensesTab({ trip }: { trip: Trip }) {
  const expenses = useMemo(() => liveExpenses(trip), [trip])
  const settlements = useMemo(() => liveSettlements(trip), [trip])
  const totals = useMemo(() => computeTotals(trip), [trip])
  const nameOf = (id: Id) => trip.members[id]?.name ?? 'Someone (removed)'

  if (expenses.length === 0 && settlements.length === 0) {
    return (
      <Empty title="No expenses yet">
        Tap <strong>Add expense</strong> the moment you pay for something — it takes five seconds
        and saves an argument later.
      </Empty>
    )
  }

  return (
    <>
      <div className="section">
        <div className="card big-total">
          <div className="value num">
            <Money amount={totals.totalSpentMinor} currency={trip.currency} />
          </div>
          <div className="label">total spent on this trip</div>
        </div>
      </div>

      {expenses.length > 0 && (
        <div className="section">
          <h2>Expenses</h2>
          <div className="card">
            {expenses.map((e) => {
              const payer = trip.members[e.paidBy]
              return (
                <button
                  key={e.id}
                  className="row"
                  onClick={() => navigate(`/trip/${trip.id}/expense/${e.id}`)}
                >
                  {payer ? (
                    <Avatar member={payer} />
                  ) : (
                    <div className="avatar" style={{ background: '#475569' }}>
                      ?
                    </div>
                  )}
                  <div className="grow">
                    <div className="title">{e.description || 'Expense'}</div>
                    <div className="meta">
                      {shortDate(e.date)} · {nameOf(e.paidBy)} paid · {e.parts.length} sharing
                    </div>
                  </div>
                  <div className="amount">
                    <Money amount={e.amountMinor} currency={trip.currency} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {settlements.length > 0 && (
        <div className="section">
          <h2>Repayments</h2>
          <div className="card">
            {settlements.map((s) => (
              <div key={s.id} className="row" style={{ cursor: 'default' }}>
                <div className="grow">
                  <div className="title">
                    {nameOf(s.fromMember)} → {nameOf(s.toMember)}
                  </div>
                  <div className="meta">{shortDate(s.date)}{s.note ? ` · ${s.note}` : ''}</div>
                </div>
                <div className="amount">
                  <Money amount={s.amountMinor} currency={trip.currency} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function BalancesTab({ trip }: { trip: Trip }) {
  const { db } = useStore()
  const totals = useMemo(() => computeTotals(trip), [trip])
  const me = db.identities[trip.id]
  const settled = totals.balances.every((b) => b.netMinor === 0)

  if (totals.balances.length === 0) {
    return <Empty title="Nobody on this trip yet">Add people first, then log an expense.</Empty>
  }

  return (
    <div className="section">
      <h2>Who is up, who is down</h2>
      <div className="card">
        {totals.balances.map((b) => {
          const member = trip.members[b.memberId]
          const label =
            b.netMinor > 0 ? 'is owed' : b.netMinor < 0 ? 'owes the group' : 'all square'
          return (
            <div key={b.memberId} className="row" style={{ cursor: 'default' }}>
              {member ? (
                <Avatar member={member} />
              ) : (
                <div className="avatar" style={{ background: '#475569' }}>
                  ?
                </div>
              )}
              <div className="grow">
                <div className="title">
                  {member?.name ?? 'Someone (removed)'}
                  {b.memberId === me && <> <span className="chip tiny">you</span></>}
                  {member?.deletedAt != null && (
                    <> <span className="chip tiny">removed</span></>
                  )}
                </div>
                <div className="meta">
                  {label} · paid <Money amount={b.paidMinor} currency={trip.currency} />, used{' '}
                  <Money amount={b.owedMinor} currency={trip.currency} />
                </div>
              </div>
              <div className="amount">
                <Money amount={b.netMinor} currency={trip.currency} signed />
              </div>
            </div>
          )
        })}
      </div>
      {settled && (
        <div className="notice good" style={{ marginTop: 10 }}>
          <strong>Everyone is square.</strong> Nothing left to pay.
        </div>
      )}
      <p className="hint">
        These numbers only cover expenses that have reached this phone. Sync with everyone before
        treating them as final.
      </p>
    </div>
  )
}
