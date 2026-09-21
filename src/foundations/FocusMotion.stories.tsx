import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, useSyncExternalStore } from 'react'
import { Page, Section, TokenName } from './specimen'

const reducedMotion = '(prefers-reduced-motion: reduce)'

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotion)
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(reducedMotion).matches,
  )
}

function MotionDemo() {
  const [shown, setShown] = useState(false)
  const reduced = usePrefersReducedMotion()
  return (
    <>
      <div className="fd-focus-row">
        <button
          className="fd-native-button"
          type="button"
          aria-pressed={shown}
          onClick={() => {
            setShown(!shown)
          }}
        >
          {shown ? 'Hide state change' : 'Show state change'}
        </button>
        <span role="status">
          Reduced motion is {reduced ? 'on: transitions are near-instant' : 'off'}.
        </span>
      </div>
      <div className="fd-motion" data-shown={shown} aria-hidden={!shown}>
        Fades and rises 16px over <code>--duration-state</code>.
      </div>
    </>
  )
}

function FocusMotionPage() {
  return (
    <Page
      title="Focus and motion"
      intro="Every focusable element shows a visible focus outline. Motion is short and only for small state changes."
    >
      <Section
        title="Focus"
        note="A 2px solid outline with a 2px offset on :focus-visible. Press Tab to move through these native elements."
      >
        <div className="fd-focus-row" id="focus-sample">
          <button className="fd-native-button" type="button">
            Button
          </button>
          <a href="#focus-sample">Link</a>
          <label className="fd-check">
            <input type="checkbox" /> Checkbox
          </label>
          <input className="fd-native-input" type="text" aria-label="Text field" />
        </div>
        <ul className="fd-rows">
          <li className="fd-row">
            <strong>Color</strong>
            <span>Blue focus, distinct from the indigo accent</span>
            <TokenName name="--focus" />
          </li>
          <li className="fd-row">
            <strong>Width</strong>
            <span>Outline thickness</span>
            <TokenName name="--focus-width" />
          </li>
          <li className="fd-row">
            <strong>Offset</strong>
            <span>Gap between element and outline, so it sits on the surrounding surface</span>
            <TokenName name="--focus-offset" />
          </li>
        </ul>
      </Section>
      <Section
        title="Motion"
        note="180ms ease-out for toast entrance, disclosure rotation, selection and hover. Never animate layout columns or message content. With reduced motion, durations collapse to near zero and smooth scrolling is off."
      >
        <MotionDemo />
        <ul className="fd-rows">
          <li className="fd-row">
            <strong>Duration</strong>
            <span>Small state changes</span>
            <TokenName name="--duration-state" />
          </li>
          <li className="fd-row">
            <strong>Easing</strong>
            <span>Decelerate into place</span>
            <TokenName name="--ease-state" />
          </li>
        </ul>
      </Section>
    </Page>
  )
}

const meta = {
  title: 'Foundations/Focus and motion',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

export const Overview: StoryObj<typeof meta> = { render: () => <FocusMotionPage /> }
