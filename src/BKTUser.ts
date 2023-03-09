interface RawBKTUser {
  id: string
  customAttributes?: Record<string, string>
}

export interface BKTUser extends RawBKTUser {
  readonly id: string
  readonly attributes: Record<string, string>
}

export const defineBKTUser = (user: RawBKTUser): BKTUser => {
  if (!user.id) {
    throw new Error('user id is required')
  }

  return {
    id: user.id,
    attributes: {
      ...user.customAttributes,
    },
  }
}
