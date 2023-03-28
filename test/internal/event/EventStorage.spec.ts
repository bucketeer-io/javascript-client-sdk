import { expect, suite, test, beforeEach, afterEach } from 'vitest'
import {
  EventEntity,
  EventStorage,
  EventStorageImpl,
} from '../../../src/internal/event/EventStorage'
import { BKTStorage, DefaultStorage } from '../../../src/internal/storage'
import {
  evaluationEvent1,
  evaluationEvent2,
  goalEvent1,
} from '../../mocks/events'

suite('internal/event/EventStorage', () => {
  let storage: BKTStorage<EventEntity>
  let eventStorage: EventStorage

  beforeEach(() => {
    storage = new DefaultStorage('bkt_event')
    eventStorage = new EventStorageImpl('user_id_1', storage)
  })

  afterEach(() => {
    storage.clear()
  })

  suite('getAll', () => {
    test('return events if saved data is present', () => {
      storage.set({
        userId: 'user_id_1',
        events: [evaluationEvent1, goalEvent1],
      })

      const result = eventStorage.getAll()

      expect(result).toStrictEqual([evaluationEvent1, goalEvent1])
    })

    test('return empty array if saved data is not present', () => {
      storage.set({
        userId: 'user_id_1',
        events: [],
      })

      const result = eventStorage.getAll()

      expect(result).toStrictEqual([])
    })
  })

  suite('add', () => {
    test('add event to storage', () => {
      storage.set({
        userId: 'user_id_1',
        events: [goalEvent1],
      })

      eventStorage.add(evaluationEvent1)

      expect(storage.get()?.events).toStrictEqual([
        goalEvent1,
        evaluationEvent1,
      ])
    })
  })

  suite('addAll', () => {
    test('add events to storage', () => {
      storage.set({
        userId: 'user_id_1',
        events: [goalEvent1],
      })

      eventStorage.addAll([evaluationEvent1, evaluationEvent2])

      expect(storage.get()?.events).toStrictEqual([
        goalEvent1,
        evaluationEvent1,
        evaluationEvent2,
      ])
    })
  })

  suite('deleteByIds', () => {
    test('delete events by ids', () => {
      storage.set({
        userId: 'user_id_1',
        events: [evaluationEvent1, evaluationEvent2, goalEvent1],
      })

      eventStorage.deleteByIds([evaluationEvent1.id, goalEvent1.id])

      expect(storage.get()?.events).toStrictEqual([evaluationEvent2])
    })
  })

  suite('clear', () => {
    test('clear events', () => {
      storage.set({
        userId: 'user_id_1',
        events: [evaluationEvent1, evaluationEvent2, goalEvent1],
      })

      eventStorage.clear()

      expect(storage.get()).toBeNull()
    })
  })
})
