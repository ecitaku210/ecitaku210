import { useState } from 'react'
import { useStore } from '../../storage/store'
import { computeTotals, liveExpenses, liveMembers } from '../../domain/balance'
import { DEFAULT_CURRENCIES } from '../../domain/money'
import { Empty, Field, Money, TopBar } from '../components'
import { navigate } from '../router'
import type { Currency } from '../../domain/types'

export function HomeScreen() {
  const { db, createTrip, usage, saveError } = useStore()
  const [creating, setCreating] = useState(false)

  const trips = Object.values(db.trips)
    .filter((t) => t.deletedAt === null)
    .sort((a, b) => b.createdAt - a.createdAt)

  return (
    <>
      <TopBar
        title="TripSplit"
        subtitle={trips.length ? `${trips.length} trip${trips.length > 1 ? 's' : ''}` : undefined}
      />
      <div className="content">
        {saveError && (
          <div className="section">
            <div className="error">
              {saveError === 'blocked'
                ? 'This browser is blocking storage, so nothing is being saved. Private/Incognito mode does this — open the app in a normal window.'
                : 'Storage is full, so your last change was not saved. Export this trip and delete an old one.'}
            </div>
          </div>
        )}

        {usage.ratio > 0.8 && !saveError && (
          <div className="section">
            <div className="notice">
              Local storage is <strong>{Math.round(usage.ratio * 100)}% full</strong>. Export and
              delete finished trips to make room.
            </div>
          </div>
        )}

        {trips.length === 0 && !creating && (
          <Empty title="No trips yet">
            Create one for your next trip, then share it with everyone going.
          </Empty>
        )}

        {trips.length > 0 && (
          <div className="section">
            <h2>Your trips</h2>
            <div className="card">
              {trips.map((trip) => {
                const me = db.identities[trip.id]
                const myBalance = me
                  ? computeTotals(trip).balances.find((b) => b.memberId === me)
                  : undefined
                return (
                  <button
                    key={trip.id}
                    className="row"
                    onClick={() => navigate(`/trip/${trip.id}`)}
                  >
                    <div className="grow">
                      <div className="title">{trip.name}</div>
                      <div className="meta">
                        {liveMembers(trip).length} people · {liveExpenses(trip).length} expenses
                      </div>
                    </div>
                    <div className="amount">
                      {/*
                        A trip you imported has no "me" yet, and showing ₹0.00
                        there would read as "you are square" when the truth is
                        "nobody has told the app who you are".
                      */}
                      {myBalance ? (
                        <Money amount={myBalance.netMinor} currency={trip.currency} signed />
                      ) : (
                        <span className="chip">who are you?</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {creating ? (
          <NewTripForm
            onCancel={() => setCreating(false)}
            onCreate={(name, currency, myName) => {
              const id = createTrip(name, currency, myName)
              setCreating(false)
              navigate(`/trip/${id}`)
            }}
          />
        ) : (
          <div className="section">
            <div className="btn-row">
              <button className="btn primary" onClick={() => setCreating(true)}>
                New trip
              </button>
              <button className="btn" onClick={() => navigate('/import')}>
                Import
              </button>
            </div>
          </div>
        )}

        <div className="section">
          <div className="notice">
            <strong>Everything stays on this phone.</strong> There is no server and no account, so
            balances only include what this phone knows. Use <strong>Share</strong> inside a trip to
            swap updates with everyone — do it daily, not just at the end.
          </div>
        </div>
      </div>
    </>
  )
}

function NewTripForm({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string, currency: Currency, myName: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [myName, setMyName] = useState('')
  const [code, setCode] = useState('INR')

  const currency = DEFAULT_CURRENCIES.find((c) => c.code === code) ?? DEFAULT_CURRENCIES[0]!
  const valid = name.trim().length > 0 && myName.trim().length > 0

  return (
    <div className="section">
      <h2>New trip</h2>
      <Field label="Trip name">
        <input
          autoFocus
          value={name}
          placeholder="Goa, March 2026"
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
      </Field>
      <Field label="Your name" hint="This is how you appear to everyone else on the trip.">
        <input
          value={myName}
          placeholder="Tarun"
          onChange={(e) => setMyName(e.target.value)}
          maxLength={80}
        />
      </Field>
      <Field label="Currency" hint="One currency per trip. Convert before entering an expense.">
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {DEFAULT_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} ({c.symbol.trim()})
            </option>
          ))}
        </select>
      </Field>
      <div className="btn-row">
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => onCreate(name.trim(), currency, myName.trim())}
        >
          Create
        </button>
      </div>
    </div>
  )
}
