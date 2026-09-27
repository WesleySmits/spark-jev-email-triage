import { createServerFn } from '@tanstack/react-start'
import { getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
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

export const getOpenWork = createServerFn({ method: 'POST' })
  .validator(
    z.strictObject({
      cursor: z
        .strictObject({
          snapshotId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          beforeId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        })
        .nullable(),
    }),
  )
  .handler(({ data }): Promise<OpenWorkRead> => {
    setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
    if (!isLoopback(getRequestIP())) return Promise.resolve({ status: 'unavailable' })
    return readOpenWork(sparkMailReader(), process.env, () => new Date(), data.cursor)
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
