import { BKTConfig } from '../BKTConfig'
import { SourceID, sourceIdFromNumber } from './model/SourceID'
import { SDK_VERSION } from './version'

// The internal config is used for the SDK's internal use only
// and should not be exposed to the user.
// The intent is not exposing the `SourceID` to the user
interface InternalConfig extends BKTConfig {
  sourceId: SourceID
  sdkVersion: string
}

const DEFAULT_WRAPPER_SDK_VERSION = '0.0.1'

const createInternalConfig = (config: BKTConfig): InternalConfig => {
  const sourceId = resolveSourceId(config)
  const sdkVersion = resolveSDKVersion(config, sourceId)
  return {
    ...config,
    sourceId: sourceId,
    sdkVersion: sdkVersion,
  }
}

function resolveSourceId(
  config: BKTConfig,): SourceID {
  const supportedWrapperSdkSourceIds = [
      SourceID.REACT,
      SourceID.REACT_NATIVE,
      SourceID.OPEN_FEATURE_JAVASCRIPT,
    ]
  if (config.wrapperSdkSourceId) {
    const wrapperSdkSourceId = sourceIdFromNumber(
      config.wrapperSdkSourceId,
    )
    if (supportedWrapperSdkSourceIds[wrapperSdkSourceId]) {
      return wrapperSdkSourceId
    }
    console.warn(
      `Unsupported wrapperSdkSourceId: ${wrapperSdkSourceId}. Defaulting to SourceID.JAVASCRIPT.`,
    )
  }
  return SourceID.JAVASCRIPT
}

function resolveSDKVersion(
  config: BKTConfig,
  resolveSourceId: SourceID,
): string {
  if (resolveSourceId !== SourceID.JAVASCRIPT) {
    if (config.wrapperSdkVersion) {
    return config.wrapperSdkVersion
    }
    return DEFAULT_WRAPPER_SDK_VERSION
  }
  return SDK_VERSION
}

export { createInternalConfig }

export type { InternalConfig }
