import { describe, expect, test } from 'vitest'
import { defineBKTUser } from '../src/BKTUser'

describe('defineBKTUser', () => {
  test('all parameters are valid', () => {
    const result = defineBKTUser({
      id: 'user-id',
      customAttributes: {
        'key-1': 'value-1',
      }
    })

    expect(result).toStrictEqual({
      id: 'user-id',
      attributes: {
        'key-1': 'value-1',
      }
    })
  })

  test('empty id throws', () => {
    expect(() => {
      defineBKTUser({
        id: '',
      })
    }).toThrowError('user id is required')
  })

  test('calling without customAttributes results in empty attributes', () => {
    const result = defineBKTUser({
      id: 'user-id',})

    expect(result).toStrictEqual({
      id: 'user-id',
      attributes: {},
    })
  })
})
