import { BKTConfig } from '../BKTConfig'
import { SourceId, sourceIdFromNumber } from './model/SourceId'
import { SDK_VERSION } from './version'

// The internal config is used for the SDK's internal use only
// and should not be exposed to the user.
// The intent is not exposing the `SourceId` to the user
interface InternalConfig extends BKTConfig {
  sourceId: SourceId
  sdkVersion: string
}

const supportedWrapperSdkSourceIds: SourceId[] = [
  SourceId.REACT,
  SourceId.REACT_NATIVE,
  SourceId.OPEN_FEATURE_JAVASCRIPT,
]

const requiredInternalConfig = (config: BKTConfig): InternalConfig => {
  const internalConfig = config as InternalConfig

  if (internalConfig.sourceId === undefined) {
    throw new Error(
      'Config is missing sourceId. Must be processed by defineBKTConfig first.',
    )
  }

  if (!internalConfig.sdkVersion) {
    throw new Error(
      'Config is missing sdkVersion. Must be processed by defineBKTConfig first.',
    )
  }

  return internalConfig
}

function resolveSourceId(config: BKTConfig): SourceId {
  if (config.wrapperSdkSourceId !== undefined) {
    const wrapperSdkSourceId = sourceIdFromNumber(config.wrapperSdkSourceId)
    if (supportedWrapperSdkSourceIds.includes(wrapperSdkSourceId)) {
      return wrapperSdkSourceId
    }
    throw new Error(
      `Unsupported wrapperSdkSourceId: ${config.wrapperSdkSourceId}}`,
    )
  }
  return SourceId.JAVASCRIPT
}

function resolveSDKVersion(
  config: BKTConfig,
  resolvedSourceId: SourceId,
): string {
  if (resolvedSourceId !== SourceId.JAVASCRIPT) {
    if (config.wrapperSdkVersion) {
      return config.wrapperSdkVersion
    }
    throw new Error('Config is missing wrapperSdkVersion')
  }
  return SDK_VERSION
}

export {
  requiredInternalConfig,
  supportedWrapperSdkSourceIds,
  resolveSourceId,
  resolveSDKVersion,
}

export type { InternalConfig }
