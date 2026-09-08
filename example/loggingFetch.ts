// Demo-only instrumentation. The SDK does not require any of this: it exists
// so this example can show what is happening on the network (which requests
// fire, whether the SSE stream is open, and when heartbeats arrive).
import type { BKTFetch, StreamReporter } from './types'

const classify = (url: string): string | null => {
  if (url.endsWith('/stream_evaluations')) return '/stream_evaluations'
  if (url.endsWith('/get_evaluations')) return '/get_evaluations'
  if (url.endsWith('/register_events')) return '/register_events'
  return null
}

// Reads the tee'd branch of the stream body, reporting an `sse` event for
// each block with an `event:` line and a `heartbeat` event for a block that
// is only SSE comment lines (the backend's `:` keep-alive).
const watchStreamBody = async (
  body: ReadableStream<Uint8Array>,
  report: StreamReporter,
  signal?: AbortSignal,
) => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // A '\r' at the very end of a chunk may be the first half of a '\r\n' that
  // the network split across two chunks. Normalizing it right away would turn
  // it into '\n' and the next chunk's leading '\n' would then look like a
  // blank line, ending the block early. Hold it back and prepend it to the
  // next chunk instead, as the SDK's own parser does. At EOF a held-back
  // '\r' needs no flush: it can only belong to an unterminated block, and
  // unterminated blocks are never reported.
  let pendingCR = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        // A clean EOF: the SDK still goes through its own reconnect/backoff,
        // but nothing else in this file will report that the stream closed.
        report({ kind: 'closed', status: undefined })
        break
      }
      let chunkText = pendingCR + decoder.decode(value, { stream: true })
      pendingCR = ''
      if (chunkText.endsWith('\r')) {
        pendingCR = '\r'
        chunkText = chunkText.slice(0, -1)
      }
      // SSE allows LF, CR, or CRLF as line endings; normalize to LF so the
      // block/line splitting below (which only looks for '\n') sees every
      // one of them.
      buffer += chunkText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const lines = block.split('\n')
        const eventLine = lines.find((line) => line.startsWith('event:'))
        if (eventLine) {
          report({
            kind: 'sse',
            name: eventLine.slice('event:'.length).trim(),
            bytes: block.length,
          })
        } else if (lines.some((line) => line.startsWith(':'))) {
          report({ kind: 'heartbeat' })
        }
      }
    }
  } catch {
    // The SDK aborts this request on close/reconnect, which rejects this
    // read loop. That is expected, not a failure worth surfacing. Any other
    // rejection is a real mid-stream failure (the connection dropped after
    // the headers arrived), which nothing else here would report, leaving
    // the panel stuck at 'open'.
    if (!signal?.aborted) {
      report({ kind: 'closed', status: undefined })
    }
  }
}

export const loggingFetch = (report: StreamReporter): BKTFetch => {
  // Arrow function, not a bound method: calling the global `fetch` bare below
  // (rather than handing this function around as `window.fetch`) avoids the
  // unbound-`this` problem the SDK works around in FetchEventSource.
  return async (url, request) => {
    const path = classify(url)
    if (path) {
      report({ kind: 'request', path, method: request.method })
    }

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, request)
    } catch (error) {
      // request.signal is set on close/reconnect so the SDK can abort this
      // fetch itself; that rejection is expected and must not overwrite the
      // 'idle' state a destroy() already set. Anything else is a real
      // failure the status panel would otherwise never learn about, since
      // no response ever arrives to report a 'closed' status from below.
      if (path === '/stream_evaluations' && !request.signal?.aborted) {
        report({ kind: 'closed', status: undefined })
      }
      throw error
    }

    if (path) {
      report({ kind: 'response', path, status: response.status })
    }

    if (path === '/stream_evaluations') {
      if (response.ok && response.body) {
        const [forSdk, forDisplay] = response.body.tee()
        watchStreamBody(forDisplay, report, request.signal)
        return new Response(forSdk, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
      report({
        kind: 'closed',
        status: response.ok ? undefined : response.status,
        // Reached with response.ok true only when response.body is missing.
        // The SDK treats a 2xx response with no body as terminal, the same
        // as a bad HTTP status (see FetchEventSource.ts:99-106: it can never
        // become readable, so retrying can't succeed either). Flag it, since
        // `status` alone can't tell this apart from a normal disconnect.
        terminal: response.ok,
      })
    }

    return response
  }
}
