import { BKTConfig } from './BKTConfig'
import { BKTEvaluation } from './BKTEvaluation'
import { BKTUser } from './BKTUser'
import { Component, DefaultComponent } from './internal/di/Component'
import { DataModule } from './internal/di/DataModule'
import { InteractorModule } from './internal/di/InteractorModule'
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
  addEvaluationUpdateListener: (listener: () => void) => string
  removeEvaluationUpdateListener: (listenerId: string) => void
  clearEvaluationUpdateListeners: () => void
}

export class BKTClientImpl implements BKTClient {
  component: Component
  taskScheduler: TaskScheduler | null = null

  constructor(
    config: BKTConfig,
    user: BKTUser,
    component: Component = new DefaultComponent(
      new DataModule(user, config),
      new InteractorModule(),
    ),
  ) {
    this.component = component
  }

  initializeInternal(timeoutMillis: number): Promise<void> {
    this.scheduleTasks()
    return this.fetchEvaluations(timeoutMillis)
  }

  stringVariation(featureId: string, defaultValue: string): string {
    const value = this.getVariationValue(featureId)
    if (value === null) {
      return defaultValue
    }
    return value
  }

  numberVariation(featureId: string, defaultValue: number): number {
    const value = this.getVariationValue(featureId)
    if (value === null) {
      return defaultValue
    }
    const result = Number(value)
    if (Number.isNaN(result)) {
      return defaultValue
    }
    return result
  }

  booleanVariation(featureId: string, defaultValue: boolean): boolean {
    const value = this.getVariationValue(featureId)
    const result = value?.toLowerCase()
    if (result === 'true') {
      return true
    } else if (result === 'false') {
      return false
    } else {
      return defaultValue
    }
  }

  jsonVariation<T>(featureId: string, defaultValue: T): T {
    const value = this.getVariationValue(featureId)
    if (value === null) {
      return defaultValue
    }
    try {
      return JSON.parse(value)
    } catch (e) {
      return defaultValue
    }
  }

  track(goalId: string, value: number): void {
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
    this.component.evaluationInteractor().clearCurrentEvaluationsId()
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

  evaluationDetails(featureId: string): BKTEvaluation | null {
    const raw = this.component.evaluationInteractor().getLatest(featureId)

    if (raw) {
      return {
        id: raw.id,
        featureId: raw.featureId,
        featureVersion: raw.featureVersion,
        userId: raw.userId,
        variationId: raw.variationId,
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

  private getVariationValue(featureId: string): string | null {
    const raw = this.component.evaluationInteractor().getLatest(featureId)

    const user = this.component.userHolder().get()
    const featureTag = this.component.config().featureTag

    if (raw) {
      this.component
        .eventInteractor()
        .trackEvaluationEvent(featureTag, user, raw)
    } else {
      this.component
        .eventInteractor()
        .trackDefaultEvaluationEvent(featureTag, user, featureId)
    }

    return raw?.variationValue ?? null
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

export const initializeBKTClient = (
  config: BKTConfig,
  user: BKTUser,
  timeoutMillis = 5_000,
): Promise<void> => {
  if (getInstance()) {
    return Promise.resolve()
  }

  const client = new BKTClientImpl(config, user)
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
