import { Evaluation } from '../../src/internal/model/Evaluation'
import { UserEvaluations } from '../../src/internal/model/UserEvaluations'

export const evaluation1: Evaluation = {
  id: 'test-feature-1:9:user_id_1',
  featureId: 'test-feature-1',
  featureVersion: 9,
  userId: 'user_id_1',
  variationId: 'test-feature-1-variation-A',
  variationValue: 'test variation value1',
  variation: {
    id: 'test-feature-1-variation-A',
    value: 'test variation value1',
  },
  reason: {
    type: 'CLIENT',
  },
}

export const evaluation2: Evaluation = {
  id: 'test-feature-2:9:user_id_1',
  featureId: 'test-feature-2',
  featureVersion: 9,
  userId: 'user_id_1',
  variationId: 'test-feature-2-variation-A',
  variationValue: 'test variation value2',
  variation: {
    id: 'test-feature-2-variation-A',
    value: 'test variation value2',
  },
  reason: {
    type: 'CLIENT',
  },
}

export const evaluation3: Evaluation = {
  id: 'test-feature-1:9:user_id_2',
  featureId: 'test-feature-3',
  featureVersion: 9,
  userId: 'user_id_2',
  variationId: 'test-feature-1-variation-A',
  variationValue: 'test variation value2',
  variation: {
    id: 'test-feature-1-variation-A',
    value: 'test variation value2',
  },
  reason: {
    type: 'CLIENT',
  },
}

export const user1Evaluations: UserEvaluations = {
  id: '17388826713971171773',
  evaluations: [evaluation1, evaluation2],
}
