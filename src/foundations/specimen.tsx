// Layout helpers for the Foundations stories. Storybook-only; not app UI.
import { useSyncExternalStore, type ReactNode } from 'react'
import './foundations.css'

const noSubscription = () => () => undefined

/** Reads a custom property from src/styles/tokens.css as the browser resolved it. */
export function useToken(name: `--${string}`): string {
  return useSyncExternalStore(noSubscription, () =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
  )
}

export function Page({
  title,
  intro,
  children,
}: Readonly<{ title: string; intro: string; children: ReactNode }>) {
  return (
    <main className="fd-page">
      <header className="fd-head">
        <p className="fd-eyebrow">Foundations</p>
        <h1>{title}</h1>
        <p className="fd-intro">{intro}</p>
      </header>
      {children}
    </main>
  )
}

export function Section({
  title,
  note,
  children,
}: Readonly<{ title: string; note?: string; children: ReactNode }>) {
  return (
    <section className="fd-section" aria-label={title}>
      <h2>{title}</h2>
      {note === undefined ? null : <p className="fd-note">{note}</p>}
      {children}
    </section>
  )
}

export function TokenName({ name }: Readonly<{ name: `--${string}` }>) {
  const value = useToken(name)
  return (
    <span className="fd-token">
      <code>{name}</code> <code className="fd-value">{value}</code>
    </span>
  )
}

export function Note({
  label,
  children,
}: Readonly<{ label: 'Decision' | 'Source'; children: ReactNode }>) {
  return (
    <p className="fd-note-box">
      <strong>{label}:</strong> {children}
    </p>
  )
}
