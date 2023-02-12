import { BKTException } from '../../BKTExceptions'
import { GetEvaluationsResponse } from '../model/response/GetEvaluationsResponse'

export interface GetEvaluationsSuccess {
  type: 'success'
  sizeByte: number
  seconds: number
  featureTag: string
  value: GetEvaluationsResponse
}

export interface GetEvaluationsFailure {
  type: 'failure'
  featureTag: string
  error: BKTException
}

export type GetEvaluationsResult = GetEvaluationsSuccess | GetEvaluationsFailure
