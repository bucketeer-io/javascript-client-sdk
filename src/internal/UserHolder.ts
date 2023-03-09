import { BKTUser } from '../BKTUser'
import { User } from './model/User'

export class UserHolder {
  private user: User
  userId: string

  constructor(user: User) {
    this.user = user
    this.userId = this.user.id
  }

  get(): User {
    return this.user
  }

  updateAttributes(
    updater: (previous: Record<string, string>) => Record<string, string>,
  ): void {
    this.user = {
      ...this.user,
      data: updater(this.user.data ?? {}),
    }
  }
}

export function toUser(bktUser: BKTUser): User {
  return {
    id: bktUser.id,
    data: bktUser.attributes,
  }
}

export function toBKTUser(user: User): BKTUser {
  return {
    id: user.id,
    attributes: user.data ?? {},
  }
}
