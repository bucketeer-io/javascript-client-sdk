export const SourceId = {
  UNKNOWN: 0,
  ANDROID: 1,
  IOS: 2,
  // WEB: 3, // deprecated
  GOAL_BATCH: 4,
  GO_SERVER: 5,
  NODE_SERVER: 6,
  JAVASCRIPT: 7,
  FLUTTER: 8,
  REACT: 9,
  REACT_NATIVE: 10,
  OPEN_FEATURE_KOTLIN: 100,
  OPEN_FEATURE_SWIFT: 101,
  OPEN_FEATURE_JAVASCRIPT: 102,
  OPEN_FEATURE_GO: 103,
  OPEN_FEATURE_NODE: 104,

} as const

export type SourceId = (typeof SourceId)[keyof typeof SourceId]

export function sourceIdFromNumber(
  sourceId: number,
): SourceId {
  const sourceIdValue = Object.values(SourceId).find((value) => value === sourceId)
  if (sourceIdValue !== undefined) {
    return sourceIdValue
  }
  return SourceId.UNKNOWN
}
