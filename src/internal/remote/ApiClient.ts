import { BKTException } from '../../BKTExceptions'
import { GetEvaluationsRequest } from '../model/request/GetEvaluationsRequest'
import { GetEvaluationsResponse } from '../model/response/GetEvaluationsResponse'
import { SourceID } from '../model/SourceID'
import { User } from '../model/User'
import { FetchLike, FetchRequestLike } from './fetch'
import { postInternal } from './post'
import { GetEvaluationsFailure, GetEvaluationsResult, GetEvaluationsSuccess } from './GetEvaluationsResult'

export interface ApiClient {
  getEvaluations(user: User, userEvaluationsId: string, timeoutMillis?: number): Promise<GetEvaluationsResult>
}

const DEFAULT_REQUEST_TIMEOUT_MILLIS = 30_000

export class ApiClientImpl implements ApiClient {

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly featureTag: string,
    private readonly fetch: FetchLike,
    private readonly defaultRequestTimeoutMillis: number = DEFAULT_REQUEST_TIMEOUT_MILLIS,
  ) {

  }

  async getEvaluations(
    user: User,
    userEvaluationsId: string,
    timeoutMillis: number = this.defaultRequestTimeoutMillis
  ): Promise<GetEvaluationsResult> {
    const body: GetEvaluationsRequest = {
      tag: this.featureTag,
      user,
      user_evaluations_id: userEvaluationsId,
      source_id: SourceID.ANDROID
    }

    try {
      const start = Date.now()

      const res = await postInternal(
        `${this.endpoint}/get_evaluations`,
        this.createHeaders(),
        body,
        this.fetch,
        timeoutMillis
      )

      const finish = Date.now()

      const contentLength = (() =>{
        const value = res.headers.get('Content-Length')
        if (value) {
          return Number(value)
        } else {
          return 0
        }
      })()

      return {
        type: 'success',
        sizeByte: contentLength,
        seconds: (finish - start) / 1000,
        featureTag: this.featureTag,
        value: await res.json() as GetEvaluationsResponse
      } satisfies GetEvaluationsSuccess

    } catch (e) {
      // network error
      return {
        type: 'failure',
        featureTag: this.featureTag,
        error: e as BKTException,
      } satisfies GetEvaluationsFailure
    }
  }

  private createHeaders(): FetchRequestLike['headers'] {
    return {
      'Content-Type': 'application/json',
      'Authorization': this.apiKey,
    }
  }
}
