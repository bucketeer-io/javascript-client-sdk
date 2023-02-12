export const SourceID = {
  UNKNOWN: 0,
  ANDROID: 1,
  IOS: 2,
  WEB: 3,
  GOAL_BATCH: 4,
  GO_SERVER: 5,
  NODE_SERVER: 6,
} as const

export type SourceID = typeof SourceID[keyof typeof SourceID]
