import { UUID_V4_REGEX } from '../utils/regex'
import { IdGenerator } from './IdGenerator'

const toHex = (value: number): string => value.toString(16).padStart(2, '0')

// Applies the RFC 4122 v4 version and variant bits to a 16-byte array and
// returns a formatted UUID string.  The caller is responsible for supplying
// the random bytes; this function only handles layout and formatting.
const formatUuidV4 = (bytes: Uint8Array): string => {
  // RFC 4122 / UUID v4 bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, toHex)

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

// Tier 2: fills 16 bytes using `crypto.getRandomValues`.
//
// We prefer this over `randomUUID` because `randomUUID` cannot be relied upon
// to always return a valid v4 UUID:
//
//   - Insecure contexts (HTTP): `randomUUID` is restricted to secure contexts
//     and will throw or be undefined (MDN); `getRandomValues` still works.
//   - Enterprise environments: corporate IT policies can hook into `randomUUID`
//     and change the UUID version or format.
//   - Browser extensions: extensions can monkey-patch `crypto.randomUUID` on
//     the page context, producing non-standard output.
//   - Incorrect polyfills: a third-party polyfill may return a non-v4 UUID.
//   - Older / non-standard runtimes: embedded WebViews or browsers older than
//     Chrome 92 / Safari 15.4 may not implement `randomUUID` at all.
//
// We apply the RFC 4122 v4 bit layout to `getRandomValues` output ourselves,
// so the format is always under our control.
const randomBytesFromGetRandomValues = (): Uint8Array => {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

// Tier 3: fills 16 bytes using `Math.random` as a last-resort fallback.
//
// This is intentionally the weakest source of randomness in the chain.
// `Math.random` provides roughly 53 bits of precision per call, which is
// significantly less than the 128 bits of entropy produced by Web Crypto.
// Collisions are therefore more likely than with the tier-2 path — but still
// negligible across realistic event volumes within a single session.
//
// This fallback exists for deeply broken runtimes where `crypto.getRandomValues`
// is absent or throws (e.g. stripped-down embedded WebViews, aggressive
// enterprise lockdown, or broken polyfills).  In those environments, delivering
// events with weaker IDs is preferable to dropping them silently.
//
// `Math.random` is always available on any JavaScript runtime, so this path
// will never throw.
const randomBytesFromMathRandom = (): Uint8Array =>
  Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))

// Evaluates whether native `crypto.randomUUID` is suitable for UUID v4
// generation at the point this function is called.  The result is cached as a
// class field so the check runs exactly once per `BrowserIdGenerator` instance
// (and therefore once per SDK initialisation, because the platform module
// memoises the generator).
//
// Performing the check at construction time rather than at module-load time
// means test environments can control `globalThis.crypto` with plain spies —
// no `vi.resetModules()` required.
function checkNativeRandomUUID(): boolean {
  if (typeof globalThis.crypto?.randomUUID !== 'function') return false
  try {
    // `randomUUID` is restricted to secure contexts and will throw (or be
    // undefined) on http — fall back to `getRandomValues`.
    return UUID_V4_REGEX.test(globalThis.crypto.randomUUID())
  } catch {
    return false
  }
}

export class BrowserIdGenerator implements IdGenerator {
  // Validated once at construction time.  No per-call re-validation; if
  // `randomUUID` later regresses the server will reject the malformed ID,
  // which is the correct signal for a misconfigured environment.
  private readonly useNativeRandomUUID: boolean = checkNativeRandomUUID()

  newId(): string {
    // Tier 1: validated native randomUUID (decided once at construction).
    if (this.useNativeRandomUUID) {
      return globalThis.crypto.randomUUID()
    }

    // Tier 2: getRandomValues with manual RFC 4122 v4 layout.
    // Tier 3: Math.random as a last-resort for broken/missing Web Crypto.
    try {
      return formatUuidV4(randomBytesFromGetRandomValues())
    } catch {
      return formatUuidV4(randomBytesFromMathRandom())
    }
  }
}
