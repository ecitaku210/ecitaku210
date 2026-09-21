import { useMemo, useState } from 'react'
import { useStore, useTrip } from '../../storage/store'
import { buildLedgerFile, decodeLedger, encodeLedger, parseLedger } from '../../domain/ledger'
import { liveExpenses } from '../../domain/balance'
import { TopBar } from '../components'
import { navigate } from '../router'
import type { Id } from '../../domain/types'
import type { MergeSummary } from '../../domain/merge'

/**
 * Sync, the manual way.
 *
 * Three routes out, because which one works depends on the phone:
 *   1. Share sheet  — one tap into WhatsApp. Android and iOS 15+ only.
 *   2. Download     — a .json file to attach anywhere. Works everywhere.
 *   3. Copy code    — text to paste into a chat. Works even where files do not.
 *
 * All three carry the same bytes. Importing is safe to repeat because the
 * merge is idempotent, so the honest advice on this screen is "send it often".
 */
export function ShareScreen({ tripId }: { tripId: Id }) {
  const trip = useTrip(tripId)
  const { db, importTrips } = useStore()
  const [copied, setCopied] = useState(false)
  const [pasted, setPasted] = useState('')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const code = useMemo(() => {
    if (!trip) return ''
    return encodeLedger(buildLedgerFile({ [trip.id]: trip }, db.deviceId))
  }, [trip, db.deviceId])

  if (!trip) return <TopBar title="Trip not found" onBack />

  const fileName = `${slug(trip.name)}-${liveExpenses(trip).length}-expenses.tripsplit.json`
  const blob = () =>
    new Blob([JSON.stringify(buildLedgerFile({ [trip.id]: trip }, db.deviceId), null, 0)], {
      type: 'application/json',
    })

  async function shareFile() {
    const file = new File([blob()], fileName, { type: 'application/json' })
    // `canShare` with files must be checked separately: several browsers
    // expose `navigator.share` but reject file payloads.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: trip!.name })
        return
      } catch {
        // User dismissed the sheet, or the browser refused. Fall through to
        // a download rather than leaving them with nothing.
      }
    }
    downloadFile()
  }

  function downloadFile() {
    const url = URL.createObjectURL(blob())
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    // Revoking immediately can cancel the download on some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setResult({ ok: false, message: 'Could not reach the clipboard. Select the code and copy it by hand.' })
    }
  }

  function applyImport(text: string) {
    const decoded = decodeLedger(text)
    if (!decoded.ok) {
      setResult({ ok: false, message: decoded.message })
      return
    }
    const summary = importTrips(decoded.file.trips)
    setResult({
      ok: true,
      message: describe(summary) + (decoded.warnings.length ? ` ${decoded.warnings.join(' ')}` : ''),
    })
    setPasted('')
  }

  async function importFromFile(file: File) {
    try {
      const parsed = parseLedger(JSON.parse(await file.text()))
      if (!parsed.ok) {
        setResult({ ok: false, message: parsed.message })
        return
      }
      const summary = importTrips(parsed.file.trips)
      setResult({
        ok: true,
        message: describe(summary) + (parsed.warnings.length ? ` ${parsed.warnings.join(' ')}` : ''),
      })
    } catch {
      setResult({ ok: false, message: 'That file could not be read as a TripSplit ledger.' })
    }
  }

  return (
    <>
      <TopBar title="Share / sync" subtitle={trip.name} onBack />
      <div className="content">
        <div className="section">
          <div className="notice">
            <strong>Send this to everyone, every evening.</strong> Sending the same update twice is
            harmless — duplicates are impossible because each expense carries its own permanent id.
          </div>
        </div>

        <div className="section">
          <h2>Send your copy</h2>
          <button className="btn primary block" onClick={shareFile}>
            Share to WhatsApp, AirDrop, email…
          </button>
          <div className="spacer" />
          <div className="btn-row">
            <button className="btn" onClick={downloadFile}>
              Save file
            </button>
            <button className="btn" onClick={copyCode}>
              {copied ? 'Copied ✓' : 'Copy code'}
            </button>
          </div>
          <p className="hint">
            The code is {Math.ceil(code.length / 1024)} KB of text. If your chat app mangles it, send
            the file instead.
          </p>
        </div>

        <div className="section">
          <h2>Take in someone else&apos;s copy</h2>
          <label className="btn block" style={{ cursor: 'pointer' }}>
            Open a .tripsplit.json file
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importFromFile(f)
                e.target.value = ''
              }}
            />
          </label>
          <div className="spacer" />
          <textarea
            className="code-box"
            value={pasted}
            placeholder="…or paste a share code here"
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="spacer" />
          <button
            className="btn block"
            disabled={pasted.trim() === ''}
            onClick={() => applyImport(pasted)}
          >
            Merge into my copy
          </button>
        </div>

        {result && (
          <div className={result.ok ? 'notice good' : 'error'}>{result.message}</div>
        )}

        <div className="spacer" />
        <button className="btn block ghost" onClick={() => navigate(`/trip/${tripId}`)}>
          Back to trip
        </button>
      </div>
    </>
  )
}

export function describe(s: MergeSummary): string {
  const bits: string[] = []
  if (s.tripsAdded) bits.push(`${s.tripsAdded} new trip${s.tripsAdded > 1 ? 's' : ''}`)
  if (s.membersAdded) bits.push(`${s.membersAdded} new ${s.membersAdded > 1 ? 'people' : 'person'}`)
  if (s.expensesAdded) bits.push(`${s.expensesAdded} new expense${s.expensesAdded > 1 ? 's' : ''}`)
  if (s.expensesChanged) bits.push(`${s.expensesChanged} updated`)
  if (s.settlementsAdded) bits.push(`${s.settlementsAdded} repayment${s.settlementsAdded > 1 ? 's' : ''}`)
  if (bits.length === 0) return 'Nothing new — you already had everything in that copy.'
  return `Merged: ${bits.join(', ')}.`
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'trip'
  )
}
