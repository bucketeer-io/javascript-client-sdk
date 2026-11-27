// What StreamingTask needs: the stream facts only it knows, and the success
// report that polling also uses.
//
// The stream never reports a failure to the sync status. This is a product
// decision. When the stream gives up, StreamingTask starts the polling
// fallback at once, and only polling results decide the status: a poll
// success keeps or sets SYNCED, and a poll failure after the poller's
// retries sets FAILING. The status says whether the flag values are current,
// and after a give-up polling keeps them current. Reporting the stream error
// as well made the status flip between FAILING and SYNCED and told the app
// nothing new. The cost: when the server is down, the app sees FAILING only
// after the poller's retries. Why the stream stopped is not a sync status
// question.
export interface StreamingSyncReporter {
  // A put or patch arrived with a valid payload: the stream works. Calls no
  // listener. SYNCED is sent by reportSuccess(), after the values are saved.
  markStreamWorking(): void
  // The values of a valid put or patch are saved: sends SYNCED, like polling.
  reportSuccess(): void
  // A connection try failed, the server sent an error event, or the stream
  // gave up. Reports nothing: stream bytes stop moving lastSyncedAt until the
  // next put/patch, and polling failures count again.
  markStreamNotWorking(): void
  // Bytes arrived on the stream (data or a heartbeat).
  reportStreamingAlive(): void
}
