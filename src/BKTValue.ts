export type BKTJsonPrimitive = null | boolean | string | number
export type BKTJsonObject = {
  [key: string]: BKTValue
}
export type BKTJsonArray = BKTValue[]
/**
 * Represents a JSON node value.
 */
export type BKTValue = BKTJsonPrimitive | BKTJsonObject | BKTJsonArray
