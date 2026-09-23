/**
 * One unsettled Save per classification subject in this browser tab. The id
 * is written before POST, so reloading and retrying cannot invent a new id
 * for a request whose first answer was lost. Nothing is sent when storage
 * cannot retain it. Only the classification subject, chosen labels and a UUID
 * are held here; no mail subject or body is stored.
 */
import { deskReviewRequestSchema, type DeskReviewRequest } from '../../../app/desk-review'

type Choice = Omit<DeskReviewRequest, 'requestId'>

const keyFor = (classification: Choice['classification']) =>
  `spark:pending-review:v1:${JSON.stringify(classification)}`

/** `null` means local storage could not prove what is pending. */
function pendingReview(
  classification: Choice['classification'],
): DeskReviewRequest | null | undefined {
  try {
    const stored = sessionStorage.getItem(keyFor(classification))
    if (stored === null) return undefined
    const parsed: unknown = JSON.parse(stored)
    const request = deskReviewRequestSchema.safeParse(parsed)
    return request.success &&
      JSON.stringify(request.data.classification) === JSON.stringify(classification)
      ? request.data
      : null
  } catch {
    return null
  }
}

/** Persist before sending. An existing subject keeps its original request. */
export function beginReview(choice: Choice): DeskReviewRequest | null {
  const previous = pendingReview(choice.classification)
  if (previous === null) return null
  if (previous !== undefined) return previous
  try {
    const request = { ...choice, requestId: crypto.randomUUID() }
    const stored = JSON.stringify(request)
    sessionStorage.setItem(keyFor(choice.classification), stored)
    return sessionStorage.getItem(keyFor(choice.classification)) === stored ? request : null
  } catch {
    return null
  }
}

/** Clear only the request whose recorded or refused result was confirmed. */
export function finishReview(request: DeskReviewRequest): void {
  try {
    const key = keyFor(request.classification)
    const pending = pendingReview(request.classification)
    if (pending?.requestId === request.requestId) sessionStorage.removeItem(key)
  } catch {
    // The durable server result still stands; a later replay is harmless.
  }
}
