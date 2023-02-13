export const SourceID = {
  UNKNOWN: 0,
  ANDROID: 1,
  IOS: 2,
  // WEB: 3, // deprecated
  GOAL_BATCH: 4,
  GO_SERVER: 5,
  NODE_SERVER: 6,
  JAVASCRIPT: 7,
} as const

export type SourceID = typeof SourceID[keyof typeof SourceID]
