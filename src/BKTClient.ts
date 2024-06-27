import { BKTEvaluation, BKTEvaluationDetail } from './BKTEvaluation'
import { BKTUser } from './BKTUser'
import { Component } from './internal/di/Component'
import { clearInstance, getInstance, setInstance } from './internal/instance'
import { ApiId } from './internal/model/MetricsEventData'
import { TaskScheduler } from './internal/scheduler/TaskScheduler'
import { toBKTUser } from './internal/UserHolder'

export interface BKTClient {
  stringVariation: (featureId: string, defaultValue: string) => string
  numberVariation: (featureId: string, defaultValue: number) => number
  booleanVariation: (featureId: string, defaultValue: boolean) => boolean
  jsonVariation: <T>(featureId: string, defaultValue: T) => T
  track: (goalId: string, value: number) => void
  currentUser: () => BKTUser
  updateUserAttributes: (attributes: Record<string, string>) => void
  fetchEvaluations: (timeoutMillis?: number) => Promise<void>
  flush: () => Promise<void>
  evaluationDetails: (featureId: string) => BKTEvaluation | null
  stringVariationDetails: (
    featureId: string,
    defaultValue: string,
  ) => BKTEvaluationDetail<string> | null
  numberVariationDetails: (
    featureId: string,
    defaultValue: number,
  ) => BKTEvaluationDetail<number> | null
  booleanVariationDetails: (
    featureId: string,
    defaultValue: boolean,
  ) => BKTEvaluationDetail<boolean> | null
  jsonVariationDetails: <T>(
    featureId: string,
    defaultValue: T,
  ) => BKTEvaluationDetail<T> | null
  addEvaluationUpdateListener: (listener: () => void) => string
  removeEvaluationUpdateListener: (listenerId: string) => void
  clearEvaluationUpdateListeners: () => void
}

export class BKTClientImpl implements BKTClient {
  taskScheduler: TaskScheduler | null = null

  constructor(public component: Component) {}

  initializeInternal(timeoutMillis: number): Promise<void> {
    this.scheduleTasks()
    return this.fetchEvaluations(timeoutMillis)
  }

  stringVariation(featureId: string, defaultValue: string): string {
    const value = this.getVariationDetails(
      featureId,
      defaultValue,
    ).variationValue
    return value
  }

  numberVariation(featureId: string, defaultValue: number): number {
    const value = this.getVariationDetails(
      featureId,
      defaultValue,
    ).variationValue
    return value
  }

  booleanVariation(featureId: string, defaultValue: boolean): boolean {
    const value = this.getVariationDetails(
      featureId,
      defaultValue,
    ).variationValue
    return value
  }

  jsonVariation<T>(featureId: string, defaultValue: T): T {
    const value = this.getVariationDetails(
      featureId,
      defaultValue,
    ).variationValue
    return value
  }

  stringVariationDetails(
    featureId: string,
    defaultValue: string,
  ): BKTEvaluationDetail<string> | null {
    return this.getVariationDetails(featureId, defaultValue)
  }
  numberVariationDetails(
    featureId: string,
    defaultValue: number,
  ): BKTEvaluationDetail<number> | null {
    return this.getVariationDetails(featureId, defaultValue)
  }
  booleanVariationDetails(
    featureId: string,
    defaultValue: boolean,
  ): BKTEvaluationDetail<boolean> | null {
    return this.getVariationDetails(featureId, defaultValue)
  }
  jsonVariationDetails<T>(
    featureId: string,
    defaultValue: T,
  ): BKTEvaluationDetail<T> | null {
    return this.getVariationDetails(featureId, defaultValue)
  }

  track(goalId: string, value = 0.0): void {
    this.component
      .eventInteractor()
      .trackGoalEvent(
        this.component.config().featureTag,
        this.component.userHolder().get(),
        goalId,
        value,
      )
  }

  currentUser(): BKTUser {
    return toBKTUser(this.component.userHolder().get())
  }

  updateUserAttributes(attributes: Record<string, string>): void {
    this.component.userHolder().updateAttributes((_prev) => ({ ...attributes }))
    this.component.evaluationInteractor().setUserAttributesUpdated()
  }

  async fetchEvaluations(timeoutMillis?: number): Promise<void> {
    return BKTClientImpl.fetchEvaluationsInternal(this.component, timeoutMillis)
  }

  async flush(): Promise<void> {
    const result = await this.component.eventInteractor().sendEvents(true)

    if (result.type === 'failure') {
      throw result.error
    }
  }

  /**
   * @deprecated use stringVariationDetails(featureId: string, defaultValue: string) instead.
   */
  evaluationDetails(featureId: string): BKTEvaluation | null {
    const raw = this.component.evaluationInteractor().getLatest(featureId)

    if (raw) {
      return {
        id: raw.id,
        featureId: raw.featureId,
        featureVersion: raw.featureVersion,
        userId: raw.userId,
        variationId: raw.variationId,
        variationName: raw.variationName,
        variationValue: raw.variationValue,
        reason: raw.reason.type,
      } satisfies BKTEvaluation
    }

    return null
  }

  addEvaluationUpdateListener(listener: () => void): string {
    return this.component.evaluationInteractor().addUpdateListener(listener)
  }

  removeEvaluationUpdateListener(listenerId: string) {
    this.component.evaluationInteractor().removeUpdateListener(listenerId)
  }

  clearEvaluationUpdateListeners() {
    this.component.evaluationInteractor().clearUpdateListeners()
  }

  private getVariationDetails<T>(
    featureId: string,
    defaultValue: T,
  ): BKTEvaluationDetail<T> {
    const raw = this.component.evaluationInteractor().getLatest(featureId)
    const user = this.component.userHolder().get()
    const featureTag = this.component.config().featureTag

    const variationValue = raw?.variationValue

    // Handle conversion based on the type of T
    let result: T | null = null

    if (variationValue !== undefined && variationValue !== null) {
      if (variationValue !== undefined && variationValue !== null) {
        result = convertToType<T>(variationValue, defaultValue)
      }
    }

    if (raw && result) {
      this.component
        .eventInteractor()
        .trackEvaluationEvent(featureTag, user, raw)
      return {
        featureId: raw.featureId,
        featureVersion: raw.featureVersion,
        userId: raw.userId,
        variationId: raw.variationId,
        variationName: raw.variationName,
        variationValue: result,
        reason: raw.reason.type,
      } satisfies BKTEvaluationDetail<T>
    } else {
      this.component
        .eventInteractor()
        .trackDefaultEvaluationEvent(featureTag, user, featureId)
      return {
        featureId: featureId,
        featureVersion: 0,
        userId: user.id,
        variationId: '',
        variationName: '',
        variationValue: result ?? defaultValue,
        reason: 'CLIENT',
      } satisfies BKTEvaluationDetail<T>
    }
  }

  private scheduleTasks(): void {
    this.taskScheduler = new TaskScheduler(this.component)
    this.taskScheduler.start()
  }

  resetTasks(): void {
    if (this.taskScheduler) {
      this.taskScheduler.stop()
      this.taskScheduler = null
    }
  }

  static async fetchEvaluationsInternal(
    component: Component,
    timeoutMillis?: number,
  ): Promise<void> {
    const result = await component
      .evaluationInteractor()
      .fetch(component.userHolder().get(), timeoutMillis)

    if (result.type === 'failure') {
      component
        .eventInteractor()
        .trackFailure(
          ApiId.GET_EVALUATIONS,
          component.config().featureTag,
          result.error,
        )
      throw result.error
    } else {
      component
        .eventInteractor()
        .trackSuccess(
          ApiId.GET_EVALUATIONS,
          component.config().featureTag,
          result.seconds,
          result.sizeByte,
        )
    }
  }
}

export const getBKTClient = (): BKTClient | null => {
  return getInstance()
}

export const initializeBKTClientInternal = (
  component: Component,
  timeoutMillis = 5_000,
): Promise<void> => {
  if (getInstance()) {
    return Promise.resolve()
  }

  const client = new BKTClientImpl(component)
  setInstance(client)

  return client.initializeInternal(timeoutMillis)
}

export const destroyBKTClient = (): void => {
  const client = getInstance()
  if (client) {
    ;(client as BKTClientImpl).resetTasks()
  }
  clearInstance()
}

function convertToType<T>(value: string, testValueType: T): T | null {
  try {
    if (typeof testValueType === 'string') {
      return value as T
    } else if (typeof testValueType === 'number') {
      const parsedNumber = Number(value)
      return isNaN(parsedNumber) ? null : (parsedNumber as T)
    } else if (typeof testValueType === 'boolean') {
      const lowcaseValue = value.toLowerCase()
      if (lowcaseValue === 'true') {
        return true as T
      } else if (lowcaseValue === 'false') {
        return false as T
      } else {
        return null
      }
    } else if (typeof testValueType === 'object') {
      return JSON.parse(value) as T
    } else {
      return null
    }
  } catch (e) {
    console.error('Conversion failed:', e)
    return null
  }
}
