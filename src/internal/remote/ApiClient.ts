import { BKTException } from '../../BKTExceptions'
import { GetEvaluationsRequest } from '../model/request/GetEvaluationsRequest'
import { GetEvaluationsResponse } from '../model/response/GetEvaluationsResponse'
import { SourceID } from '../model/SourceID'
import { FetchLike, FetchRequestLike } from './fetch'
import { postInternal } from './post'
import {
  GetEvaluationsFailure,
  GetEvaluationsResult,
  GetEvaluationsSuccess,
} from './GetEvaluationsResult'
import { Event } from '../model/Event'
import { RegisterEventsResult } from './RegisterEventsResult'
import { RegisterEventsRequest } from '../model/request/RegisterEventsRequest'
import { RegisterEventsResponse } from '../model/response/RegisterEventsResponse'
import { SDK_VERSION } from '../version'

export interface ApiClient {
  getEvaluations(
    request: Omit<GetEvaluationsRequest, 'sourceId' | 'sdkVersion'>,
    timeoutMillis?: number,
  ): Promise<GetEvaluationsResult>
  registerEvents(events: Event[]): Promise<RegisterEventsResult>
}

const DEFAULT_REQUEST_TIMEOUT_MILLIS = 30_000

export class ApiClientImpl implements ApiClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly fetch: FetchLike,
    private readonly defaultRequestTimeoutMillis: number = DEFAULT_REQUEST_TIMEOUT_MILLIS,
  ) {}

  async getEvaluations(
    request: Omit<GetEvaluationsRequest, 'sourceId' | 'sdkVersion'>,
    timeoutMillis: number | undefined = this.defaultRequestTimeoutMillis,
  ): Promise<GetEvaluationsResult> {
    const body: GetEvaluationsRequest = {
      ...request,
      sourceId: SourceID.JAVASCRIPT,
      sdkVersion: SDK_VERSION,
    }

    try {
      const start = Date.now()

      const res = await postInternal(
        `${this.endpoint}/get_evaluations`,
        this.createHeaders(),
        body,
        this.fetch,
        timeoutMillis,
      )

      const finish = Date.now()

      // all non-ok status code is already converted to BKTException,
      // so we can assume that the status code is 200 here.
      const contentLength = (() => {
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
        featureTag: request.tag,
        value: (await res.json()) as GetEvaluationsResponse,
      } satisfies GetEvaluationsSuccess
    } catch (e) {
      return {
        type: 'failure',
        featureTag: request.tag,
        error: e as BKTException,
      } satisfies GetEvaluationsFailure
    }
  }

  async registerEvents(events: Event[]): Promise<RegisterEventsResult> {
    const body: RegisterEventsRequest = {
      events,
      sdkVersion: SDK_VERSION,
      sourceId: SourceID.JAVASCRIPT,
    }

    try {
      const res = await postInternal(
        `${this.endpoint}/register_events`,
        this.createHeaders(),
        body,
        this.fetch,
        this.defaultRequestTimeoutMillis,
      )

      // all non-ok status code is already converted to BKTException,
      // so we can assume that the status code is 200 here.
      return {
        type: 'success',
        value: (await res.json()) as RegisterEventsResponse,
      } satisfies RegisterEventsResult
    } catch (e) {
      return {
        type: 'failure',
        error: e as BKTException,
      } satisfies RegisterEventsResult
    }
  }

  private createHeaders(): FetchRequestLike['headers'] {
    return {
      'Content-Type': 'application/json',
      Authorization: this.apiKey,
    }
  }
}
