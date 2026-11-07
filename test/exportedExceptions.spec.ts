import { describe, it, expect } from 'vitest'
import * as exceptions from '../src/BKTExceptions'
import * as mainEntry from '../src/main'
import * as browserEntry from '../src/main.browser'
import * as nativeEntry from '../src/main.native'
import type { BKTException as MainBKTException } from '../src/main'
import type { BKTException as BrowserBKTException } from '../src/main.browser'
import type { BKTException as NativeBKTException } from '../src/main.native'

// `pnpm typecheck:test` fails here if an entry file stops exporting the type.
export type ExportedBKTException =
  | MainBKTException
  | BrowserBKTException
  | NativeBKTException

const exceptionNames = Object.keys(exceptions)

const catchError = (action: () => unknown): unknown => {
  try {
    action()
  } catch (e) {
    return e
  }
  return undefined
}

it('should have the base class and 15 exception classes', () => {
  expect(exceptionNames).toHaveLength(16)
})

describe.each([
  { entryName: 'main', entry: mainEntry },
  { entryName: 'main.browser', entry: browserEntry },
  { entryName: 'main.native', entry: nativeEntry },
])('exception classes exported from $entryName', ({ entry }) => {
  it.each(exceptionNames)('should export %s', (name) => {
    const exported = entry as unknown as Record<string, unknown>
    expect(exported[name]).toBe(exceptions[name as keyof typeof exceptions])
  })

  it('should let apps use instanceof on a config error thrown by the SDK', () => {
    const thrown = catchError(() =>
      entry.defineBKTConfig({
        apiKey: '',
        apiEndpoint: 'https://api.bucketeer.io',
        featureTag: 'tag',
        appVersion: '1.0.0',
      }),
    )

    expect(thrown).toBeInstanceOf(entry.IllegalArgumentException)
    expect(thrown).toBeInstanceOf(entry.BKTBaseException)
  })

  it('should let apps use instanceof on a user error thrown by the SDK', () => {
    const thrown = catchError(() => entry.defineBKTUser({ id: '' }))

    expect(thrown).toBeInstanceOf(entry.IllegalArgumentException)
    expect(thrown).toBeInstanceOf(entry.BKTBaseException)
  })
})
