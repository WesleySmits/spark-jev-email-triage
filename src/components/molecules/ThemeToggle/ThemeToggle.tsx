import { useEffect, useState } from 'react'
import './ThemeToggle.css'

const storageKey = 'spark-triage-theme'

/** Uses the system appearance until someone explicitly chooses a theme. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => {
      let saved: string | null = null
      try {
        saved = window.localStorage.getItem(storageKey)
      } catch {
        // Storage can be unavailable; the system preference still works.
      }
      const selected = saved === 'dark' || (saved !== 'light' && media.matches)
      document.documentElement.dataset['theme'] = selected ? 'dark' : 'light'
      setDark(selected)
    }
    update()
    media.addEventListener('change', update)
    window.addEventListener('storage', update)
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('storage', update)
    }
  }, [])

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label="Dark mode"
      aria-pressed={dark}
      onClick={() => {
        const next = !dark
        try {
          window.localStorage.setItem(storageKey, next ? 'dark' : 'light')
        } catch {
          // A usable theme choice for this page does not require storage.
        }
        document.documentElement.dataset['theme'] = next ? 'dark' : 'light'
        setDark(next)
      }}
    >
      {dark ? 'Dark' : 'Light'}
    </button>
  )
}
