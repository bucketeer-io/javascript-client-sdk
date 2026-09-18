# Bucketeer Client-side SDK for JavaScript

## Getting started
Refer to the [SDK documentation](https://docs.bucketeer.io/sdk/client-side/javascript) for instructions on how to use the SDK.

## Development

### Environment

- pnpm
  - enable it via `corepack enable`
- Node.js
  - check `./.node-version`

You need a `.env` file to provide api secrets for development (used by the test suites).
Just copy `env.template` and rename it to `.env`, then update it with your secrets.


## Example

The example app has its own `.env`, separate from the one above.

- Copy `example/env.template` to `example/.env` and update it with your API secrets.
- Define `Feature Flags` and `Goals` in your Bucketeer console.
- Run `pnpm example:serve`

### Try a real-time flag update (SSE)

- In `example/.env`, set `VITE_BKT_ENABLE_STREAMING=true`.
- Run `pnpm example:serve` and open the app in your browser.
- In the Bucketeer console, change the value of the feature flag set as `VITE_BKT_FEATURE_ID`.
- Watch the log panel on the page (it also mirrors to the browser console): an `Evaluation updated` line appears with the new value, pushed by SSE without reloading the page.
