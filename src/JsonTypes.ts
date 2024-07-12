export type BKTJsonPrimitive = null | boolean | string | number
export type BKTJsonObject = {
  [key: string]: BKTJsonValue
}
export type BKTJsonArray = BKTJsonValue[]
/**
 * Represents a JSON node value.
 */
export type BKTJsonValue = BKTJsonPrimitive | BKTJsonObject | BKTJsonArray
