# Bucketeer Client-side SDK for JavaScript

**!! This is still in development !!**


TBD

## Development

### Environment

- pnpm
  - enable it via `corepack enable`
- Node.js
  - check `./.node-version`

You need `.env` file to provide api secrets.
Just copy `env.template` and rename it to `.env`, then update it with your secrets.


## Example

- You need `.env` file. Please follow instruction in [Environment](#environment) section.
- Define `Feature Flags` and `Goals` in your Bucketeer console
- Modify `example/index.ts` to use your `Feature Tag`, `Feature IDs` and `Goal IDs`
- Run `pnpm example:serve`
