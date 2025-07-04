import { expect, suite, test, beforeEach, afterEach } from 'vitest'
import {
  EventEntity,
  EventStorage,
  EventStorageImpl,
} from '../../../src/internal/event/EventStorage'
import { BKTStorage, createBKTStorage } from '../../../src/BKTStorage'
import {
  evaluationEvent1,
  evaluationEvent2,
  goalEvent1,
} from '../../mocks/events'

suite('internal/event/EventStorage', () => {
  let storage: BKTStorage<EventEntity>
  let eventStorage: EventStorage

  beforeEach(() => {
    storage = createBKTStorage('bkt_event')
    eventStorage = new EventStorageImpl('user_id_1', storage)
  })

  afterEach(() => {
    storage.clear()
  })

  suite('getAll', () => {
    test('return events if saved data is present', async () => {
      await storage.set({
        userId: 'user_id_1',
        events: [evaluationEvent1, goalEvent1],
      })

      const result = await eventStorage.getAll()

      expect(result).toStrictEqual([evaluationEvent1, goalEvent1])
    })

    test('return empty array if saved data is not present', async () => {
      await storage.set({
        userId: 'user_id_1',
        events: [],
      })

      const result = await eventStorage.getAll()

      expect(result).toStrictEqual([])
    })
  })

  suite('add', () => {
    test('add event to storage', async () => {
      await storage.set({
        userId: 'user_id_1',
        events: [goalEvent1],
      })

      await eventStorage.add(evaluationEvent1)

      expect((await storage.get())?.events).toStrictEqual([
        goalEvent1,
        evaluationEvent1,
      ])
    })
  })

  suite('addAll', () => {
    test('add events to storage', async () => {
      await storage.set({
        userId: 'user_id_1',
        events: [goalEvent1],
      })

      await eventStorage.addAll([evaluationEvent1, evaluationEvent2])

      expect((await storage.get())?.events).toStrictEqual([
        goalEvent1,
        evaluationEvent1,
        evaluationEvent2,
      ])
    })
  })

  suite('deleteByIds', () => {
    test('delete events by ids', async () => {
      await storage.set({
        userId: 'user_id_1',
        events: [evaluationEvent1, evaluationEvent2, goalEvent1],
      })

      await eventStorage.deleteByIds([evaluationEvent1.id, goalEvent1.id])

      expect((await storage.get())?.events).toStrictEqual([evaluationEvent2])
    })
  })

  suite('clear', () => {
    test('clear events', async () => {
      await storage.set({
        userId: 'user_id_1',
        events: [evaluationEvent1, evaluationEvent2, goalEvent1],
      })

      await eventStorage.clear()

      expect((await storage.get())).toBeNull()
    })
  })
})
