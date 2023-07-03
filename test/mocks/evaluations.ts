import { Evaluation } from '../../src/internal/model/Evaluation'
import { UserEvaluations } from '../../src/internal/model/UserEvaluations'

export const evaluation1 = {
  id: 'test-feature-1:9:user_id_1',
  featureId: 'test-feature-1',
  featureVersion: 9,
  userId: 'user_id_1',
  variationId: 'test-feature-1-variation-A',
  variationName: 'test variation name1',
  variationValue: 'test variation value1',
  reason: {
    type: 'CLIENT',
  },
} satisfies Evaluation

export const evaluation2 = {
  id: 'test-feature-2:9:user_id_1',
  featureId: 'test-feature-2',
  featureVersion: 9,
  userId: 'user_id_1',
  variationId: 'test-feature-2-variation-A',
  variationName: 'test variation name2',
  variationValue: 'test variation value2',
  reason: {
    type: 'CLIENT',
  },
} satisfies Evaluation

export const evaluation3 = {
  id: 'test-feature-1:9:user_id_2',
  featureId: 'test-feature-3',
  featureVersion: 9,
  userId: 'user_id_2',
  variationId: 'test-feature-1-variation-A',
  variationName: 'test variation name2',
  variationValue: 'test variation value2',
  reason: {
    type: 'CLIENT',
  },
} satisfies Evaluation

export const user1Evaluations = {
  id: '17388826713971171773',
  evaluations: [evaluation1, evaluation2],
} satisfies UserEvaluations
