/**
 * The readiness probe's only server boundary. It only reads, and only says
 * whether Spark answers. The client build replaces it with an RPC stub, so
 * Spark stays on the server.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestIP, setResponseHeaders } from '@tanstack/react-start/server'
import { isLoopback } from './live-inbox.server'
import type { SparkReadiness } from './spark-readiness'
import { readinessFor } from './spark-readiness.server'
import { sparkReadiness } from './spark-inbox.server'

/**
 * Whether Spark answers now. Checked on this computer only, before Spark is
 * asked anything, and never cached: each answer is only true for a moment.
 */
export const getSparkReadiness = createServerFn({ method: 'GET' }).handler(
  (): Promise<SparkReadiness> => {
    setResponseHeaders(new Headers({ 'Cache-Control': 'no-store' }))
    return readinessFor(isLoopback(getRequestIP()), sparkReadiness)
  },
)
