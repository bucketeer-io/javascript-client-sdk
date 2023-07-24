import { Evaluation } from './Evaluation'

export interface UserEvaluations {
  id: string
  evaluations?: Evaluation[]
  // `createdAt` is defined as int64 in the proto file, but it returned as string since int64 can be bigger than `Number.MAX_SAFE_INTEGER`
  // see: https://github.com/bucketeer-io/bucketeer/blob/b88103b52c0a84805f6195eb4536f2f5cbad2a59/proto/feature/evaluation.proto#L43
  createdAt: string
  archivedFeatureIds: string[]
  forceUpdate: boolean
}
