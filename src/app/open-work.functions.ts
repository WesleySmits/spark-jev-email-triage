import { createServerFn } from '@tanstack/react-start'
import { getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { isLoopback } from './live-inbox.server'
import { sparkMailReader } from './spark-inbox.server'
import {
  workDecisionRequestSchema,
  workMessageRequestSchema,
  type OpenWorkRead,
  type WorkDecisionResult,
  type WorkMessageRead,
} from './open-work'
import { readOpenWork, readWorkMessage, saveWorkDecision } from './open-work.server'

export const getOpenWork = createServerFn({ method: 'POST' }).handler((): Promise<OpenWorkRead> => {
  setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
  if (!isLoopback(getRequestIP())) return Promise.resolve({ status: 'unavailable' })
  return readOpenWork(sparkMailReader())
})

export const recordWorkDecision = createServerFn({ method: 'POST' })
  .validator(workDecisionRequestSchema)
  .handler(({ data }): Promise<WorkDecisionResult> => {
    setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
    if (!isLoopback(getRequestIP())) return Promise.resolve({ status: 'unavailable' })
    return saveWorkDecision(sparkMailReader(), data)
  })

export const getWorkMessage = createServerFn({ method: 'POST' })
  .validator(workMessageRequestSchema)
  .handler(({ data }): Promise<WorkMessageRead> => {
    setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
    if (!isLoopback(getRequestIP())) return Promise.resolve({ status: 'unavailable' })
    return readWorkMessage(sparkMailReader(), data)
  })
