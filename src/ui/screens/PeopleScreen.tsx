import { useState } from 'react'
import { useStore, useTrip } from '../../storage/store'
import { computeTotals, liveMembers } from '../../domain/balance'
import { Avatar, Money, TopBar } from '../components'
import { navigate } from '../router'
import type { Id } from '../../domain/types'

export function PeopleScreen({ tripId }: { tripId: Id }) {
  const trip = useTrip(tripId)
  const { db, addMember, renameMember, removeMember, setMyself, renameTrip, deleteTrip } =
    useStore()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<Id | null>(null)
  const [editName, setEditName] = useState('')
  const [tripName, setTripName] = useState(trip?.name ?? '')

  if (!trip) return <TopBar title="Trip not found" onBack />

  const members = liveMembers(trip)
  const me = db.identities[trip.id]
  const totals = computeTotals(trip)
  const netOf = (id: Id) => totals.balances.find((b) => b.memberId === id)?.netMinor ?? 0

  return (
    <>
      <TopBar title="People" subtitle={trip.name} onBack />
      <div className="content">
        <div className="section">
          <h2>On this trip</h2>
          <div className="card">
            {members.map((m) => (
              <div key={m.id} className="row" style={{ cursor: 'default' }}>
                <Avatar member={m} />
                <div className="grow">
                  {editing === m.id ? (
                    <input
                      autoFocus
                      value={editName}
                      maxLength={80}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => {
                        if (editName.trim()) renameMember(trip.id, m.id, editName.trim())
                        setEditing(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                    />
                  ) : (
                    <>
                      <div className="title">
                        {m.name}
                        {m.id === me && <span className="chip" style={{ marginLeft: 8 }}>you</span>}
                      </div>
                      <div className="meta">
                        net <Money amount={netOf(m.id)} currency={trip.currency} signed />
                      </div>
                    </>
                  )}
                </div>
                {editing !== m.id && (
                  <button
                    className="btn icon ghost"
                    onClick={() => {
                      setEditing(m.id)
                      setEditName(m.name)
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h2>Add someone</h2>
          <div className="inline">
            <input
              value={newName}
              placeholder="Name"
              maxLength={80}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) {
                  addMember(trip.id, newName.trim())
                  setNewName('')
                }
              }}
            />
            <button
              className="btn primary"
              disabled={!newName.trim()}
              onClick={() => {
                addMember(trip.id, newName.trim())
                setNewName('')
              }}
            >
              Add
            </button>
          </div>
          <p className="hint">
            Add everyone on one phone, then share the trip — that way the whole group uses the same
            person records instead of each phone inventing its own.
          </p>
        </div>

        <div className="section">
          <h2>Which one is you?</h2>
          <select value={me ?? ''} onChange={(e) => setMyself(trip.id, e.target.value)}>
            <option value="">Not set</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <p className="hint">
            Only used to highlight your own balance. It is never shared.
          </p>
        </div>

        <div className="section">
          <h2>Trip name</h2>
          <div className="inline">
            <input value={tripName} maxLength={120} onChange={(e) => setTripName(e.target.value)} />
            <button
              className="btn"
              disabled={!tripName.trim() || tripName.trim() === trip.name}
              onClick={() => renameTrip(trip.id, tripName.trim())}
            >
              Save
            </button>
          </div>
        </div>

        <div className="section">
          <h2>Remove someone</h2>
          <div className="card">
            {members.map((m) => (
              <div key={m.id} className="row" style={{ cursor: 'default' }}>
                <div className="grow">
                  <div className="title">{m.name}</div>
                  <div className="meta">
                    {netOf(m.id) === 0
                      ? 'square — safe to remove'
                      : 'still has a balance; settle up first'}
                  </div>
                </div>
                <button
                  className="btn icon danger"
                  onClick={() => {
                    if (
                      confirm(
                        `Remove ${m.name}? Expenses they already paid for or shared in stay exactly as they are — nothing is recalculated.`,
                      )
                    ) {
                      removeMember(trip.id, m.id)
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <p className="hint">
            Removing someone hides them from new expenses only. Their past shares stay on the books,
            because rewriting history would change what everyone else owes.
          </p>
        </div>

        <div className="section">
          <button
            className="btn danger block"
            onClick={() => {
              if (
                confirm(
                  `Delete "${trip.name}" from this phone? Anyone you have already shared it with keeps their copy.`,
                )
              ) {
                deleteTrip(trip.id)
                navigate('/')
              }
            }}
          >
            Delete this trip
          </button>
        </div>
      </div>
    </>
  )
}
