import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  shortcutsOnByDefault,
  storedShortcutsOn,
  storeShortcutsOn,
  watchShortcutsOn,
} from './shortcut-preference'

/** A stand-in for `localStorage` over a plain map, starting from `entries`. */
function storage(entries: Readonly<Record<string, string>> = {}) {
  const items = new Map(Object.entries(entries))
  const fake = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
  vi.stubGlobal('localStorage', fake)
  return items
}

/** A storage that refuses everything, as a blocked or full one does. */
function refusingStorage() {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('quota')
    },
  })
}

/** A stand-in for `window`, which is where another tab's storage event arrives. */
function windowEvents() {
  const added = new Map<string, unknown>()
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: unknown) => {
      added.set(type, listener)
    },
    removeEventListener: (type: string) => {
      added.delete(type)
    },
  })
  return added
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shortcut preference', () => {
  it('leaves the keys on until someone turns them off', () => {
    storage()
    expect(shortcutsOnByDefault).toBe(true)
    expect(storedShortcutsOn()).toBe(true)
  })

  it('reads back the choice it stored', () => {
    const items = storage()
    storeShortcutsOn(false)
    expect(storedShortcutsOn()).toBe(false)
    storeShortcutsOn(true)
    expect(storedShortcutsOn()).toBe(true)
    // One flag under one key, and nothing about any mail.
    expect([...items.keys()]).toEqual(['spark:single-key-shortcuts:v1'])
    expect([...items.values()]).toEqual(['on'])
  })

  it('keeps the stored choice across a reload of the page', () => {
    storage()
    storeShortcutsOn(false)
    vi.resetModules()
    expect(storedShortcutsOn()).toBe(false)
  })

  it('falls back to the default for a value it did not write', () => {
    storage({ 'spark:single-key-shortcuts:v1': 'maybe' })
    expect(storedShortcutsOn()).toBe(true)
  })

  it('leaves the keys at their default when storage refuses', () => {
    refusingStorage()
    expect(storedShortcutsOn()).toBe(shortcutsOnByDefault)
    expect(() => {
      storeShortcutsOn(false)
    }).not.toThrow()
  })

  it('leaves the keys at their default where there is no storage at all', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(storedShortcutsOn()).toBe(shortcutsOnByDefault)
    expect(() => {
      storeShortcutsOn(false)
    }).not.toThrow()
  })
})

describe('watching the shortcut preference', () => {
  it('tells this tab whenever the choice is stored', () => {
    storage()
    windowEvents()
    const told = vi.fn()
    const stop = watchShortcutsOn(told)
    storeShortcutsOn(false)
    expect(told).toHaveBeenCalledTimes(1)
    expect(storedShortcutsOn()).toBe(false)
    stop()
    storeShortcutsOn(true)
    expect(told).toHaveBeenCalledTimes(1)
  })

  it('listens for the storage event of another tab, and stops again', () => {
    storage()
    const added = windowEvents()
    const told = vi.fn()
    const stop = watchShortcutsOn(told)
    expect(added.get('storage')).toBe(told)
    stop()
    expect(added.has('storage')).toBe(false)
  })

  it('still tells its readers when storage refuses the write', () => {
    refusingStorage()
    windowEvents()
    const told = vi.fn()
    const stop = watchShortcutsOn(told)
    storeShortcutsOn(false)
    expect(told).toHaveBeenCalledTimes(1)
    // Nothing was stored, so the keys stay at their default.
    expect(storedShortcutsOn()).toBe(shortcutsOnByDefault)
    stop()
  })
})
