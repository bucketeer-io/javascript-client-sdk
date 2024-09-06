import {
  BKTEvaluation,
  BKTEvaluationDetail as BKTEvaluationDetails,
} from './BKTEvaluation'
import { BKTUser } from './BKTUser'
import { Component } from './internal/di/Component'
import { clearInstance, getInstance, setInstance } from './internal/instance'
import { ApiId } from './internal/model/MetricsEventData'
import { TaskScheduler } from './internal/scheduler/TaskScheduler'
import { toBKTUser } from './internal/UserHolder'
import { BKTValue } from './JsonTypes'

export interface BKTClient {
  booleanVariation: (featureId: string, defaultValue: boolean) => boolean

  booleanVariationDetails: (
    featureId: string,
    defaultValue: boolean,
  ) => BKTEvaluationDetails<boolean>

  stringVariation: (featureId: string, defaultValue: string) => string

  stringVariationDetails: (
    featureId: string,
    defaultValue: string,
  ) => BKTEvaluationDetails<string>

  numberVariation: (featureId: string, defaultValue: number) => number

  numberVariationDetails: (
    featureId: string,
    defaultValue: number,
  ) => BKTEvaluationDetails<number>
  
  objectVariation: (featureId: string, defaultValue: BKTValue) => BKTValue
  
  /**
   * Retrieves the evaluation details for a given feature based on its ID.
   *
   * @param featureId - The unique identifier for the feature.
   * @param defaultValue - The default value to return if no result is found. This value should be of type `BKTValue`.
   *
   * @returns An object of type `BKTEvaluationDetail<BKTValue>` containing the evaluation details.
   *
   * Note: The returned value will be either a BKTJsonObject or a BKTJsonArray. If no result is found, it will return the provided `defaultValue`, which can be of any type within `BKTValue`.
   */
  objectVariationDetails: (
    featureId: string,
    defaultValue: BKTValue,
  ) => BKTEvaluationDetails<BKTValue>

  /**
   * @deprecated use objectVariation(featureId: string, defaultValue: BKTValue) instead.
   */
  jsonVariation: <T>(featureId: string, defaultValue: T) => T

  track: (goalId: string, value: number) => void
  currentUser: () => BKTUser
  updateUserAttributes: (attributes: Record<string, string>) => void
  fetchEvaluations: (timeoutMillis?: number) => Promise<void>
  flush: () => Promise<void>
  /**
   * @deprecated use stringVariationDetails(featureId: string, defaultValue: string) instead.
   */
  evaluationDetails: (featureId: string) => BKTEvaluation | null

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

  booleanVariation(featureId: string, defaultValue: boolean): boolean {
    return this.booleanVariationDetails(featureId, defaultValue).variationValue
  }

  booleanVariationDetails(
    featureId: string,
    defaultValue: boolean,
  ): BKTEvaluationDetails<boolean> {
    return this.getVariationDetails(
      featureId,
      defaultValue,
      stringToBoolConverter,
    )
  }

  numberVariation(featureId: string, defaultValue: number): number {
    return this.numberVariationDetails(featureId, defaultValue).variationValue
  }

  numberVariationDetails(
    featureId: string,
    defaultValue: number,
  ): BKTEvaluationDetails<number> {
    return this.getVariationDetails(
      featureId,
      defaultValue,
      stringToNumberConverter,
    )
  }
  
  stringVariation(featureId: string, defaultValue: string): string {
    return this.stringVariationDetails(featureId, defaultValue).variationValue
  }

  stringVariationDetails(
    featureId: string,
    defaultValue: string,
  ): BKTEvaluationDetails<string> {
    return this.getVariationDetails(
      featureId,
      defaultValue,
      defaultStringToTypeConverter,
    )
  }

  objectVariation(featureId: string, defaultValue: BKTValue): BKTValue {
    const value = this.objectVariationDetails(
      featureId,
      defaultValue,
    ).variationValue
    return value
  }

  objectVariationDetails(
    featureId: string,
    defaultValue: BKTValue,
  ): BKTEvaluationDetails<BKTValue> {
    return this.getVariationDetails(
      featureId,
      defaultValue,
      stringToObjectConverter,
    )
  }

  jsonVariation<T>(featureId: string, defaultValue: T): T {
    const value = this.getVariationValue(featureId)
    if (value === null) {
      return defaultValue
    }
    try {
      return JSON.parse(value)
    } catch {
      return defaultValue
    }
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

  private getVariationDetails<T extends BKTValue>(
    featureId: string,
    defaultValue: T,
    typeConverter: StringToTypeConverter<T>,
  ): BKTEvaluationDetails<T> {
    const raw = this.component.evaluationInteractor().getLatest(featureId)
    const user = this.component.userHolder().get()
    const featureTag = this.component.config().featureTag

    const variationValue = raw?.variationValue

    // Handle conversion based on the type of T
    let result: T | null = null

    if (variationValue !== undefined && variationValue !== null) {
      try {
        result = typeConverter(variationValue)
      } catch (err) {
        result = null
      }
    }

    if (raw !== null && result !== null) {
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
      } satisfies BKTEvaluationDetails<T>
    } else {
      this.component
        .eventInteractor()
        .trackDefaultEvaluationEvent(featureTag, user, featureId)

      return newDefaultBKTEvaluationDetails(user.id, featureId, defaultValue)
    }
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

function assetNonBlankString(input: string) {
  if (input.trim().length == 0) {
    throw new Error('Input string must be non-blank')
  }
}

function parseJsonObjectOrArray(input: string) {
  const primitiveTypes = ['number', 'string', 'boolean', 'null']
  const parsed = JSON.parse(input)

  if (primitiveTypes.includes(typeof parsed) || parsed === null) {
    throw new Error('Only JSON objects or array are allowed')
  }

  return parsed
}

export const newDefaultBKTEvaluationDetails = <T extends BKTValue>(
  userId: string,
  featureId: string,
  defaultValue: T,
): BKTEvaluationDetails<T> => {
  return {
    featureId: featureId,
    featureVersion: 0,
    userId: userId,
    variationId: '',
    variationName: '',
    variationValue: defaultValue,
    reason: 'CLIENT',
  } satisfies BKTEvaluationDetails<T>
}

export type StringToTypeConverter<T> = (input: string) => T | null

export const defaultStringToTypeConverter: StringToTypeConverter<string> = (
  input: string,
) => input

export const stringToBoolConverter: StringToTypeConverter<boolean> = (
  input: string,
) => {
  assetNonBlankString(input)

  const lowcaseValue = input.toLowerCase()
  if (lowcaseValue === 'true') {
    return true
  } else if (lowcaseValue === 'false') {
    return false
  } else {
    return null
  }
}

export const stringToNumberConverter: StringToTypeConverter<number> = (
  input: string,
) => {
  assetNonBlankString(input)
  const parsedNumber = Number(input)
  return isNaN(parsedNumber) ? null : parsedNumber
}

export const stringToObjectConverter: StringToTypeConverter<BKTValue> = (
  input: string,
) => {
  assetNonBlankString(input)
  return parseJsonObjectOrArray(input)
}
