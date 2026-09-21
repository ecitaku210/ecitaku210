import type { ReactNode } from 'react'
import type { Currency, Member, Minor } from '../domain/types'
import { formatMoney } from '../domain/money'
import { back } from './router'

export function TopBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string
  subtitle?: string
  onBack?: boolean
  right?: ReactNode
}) {
  return (
    <header className="topbar">
      {onBack && (
        <button className="btn ghost icon" onClick={back} aria-label="Go back">
          ←
        </button>
      )}
      <h1>
        {title}
        {subtitle && <span className="sub">{subtitle}</span>}
      </h1>
      {right}
    </header>
  )
}

/**
 * Colour is derived from the member id rather than stored, so the same person
 * gets the same colour on every phone in the group without that colour having
 * to be replicated and merged.
 */
export function avatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return `hsl(${hash % 360} 62% 66%)`
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

export function Avatar({ member, small }: { member: Member; small?: boolean }) {
  return (
    <div
      className={`avatar${small ? ' sm' : ''}`}
      style={{ background: avatarColor(member.id) }}
      aria-hidden="true"
    >
      {initials(member.name)}
    </div>
  )
}

export function Money({
  amount,
  currency,
  signed,
}: {
  amount: Minor
  currency: Currency
  /** Colours the value green/red. Off for neutral totals like "trip spend". */
  signed?: boolean
}) {
  const tone = !signed ? '' : amount > 0 ? ' pos' : amount < 0 ? ' neg' : ' zero'
  return <span className={`money num${tone}`}>{formatMoney(amount, currency)}</span>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** `2026-01-04` -> `4 Jan`. Short because it sits in a dense list. */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]}`
}
