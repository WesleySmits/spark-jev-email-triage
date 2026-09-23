/**
 * `GET /health`: which commit this server was built from.
 *
 * A server route, not a page: it has a request handler and no component, so
 * nothing here renders and nothing here reaches the browser bundle. It reads
 * one environment variable through `release/health.server`, and no mailbox,
 * provider or database, which is why it is safe to expose to a monitor.
 */
import { createFileRoute } from '@tanstack/react-router'
import { healthResponse } from '../release/health.server'

export const Route = createFileRoute('/health')({
  server: {
    handlers: {
      GET: () => healthResponse(process.env),
    },
  },
})
