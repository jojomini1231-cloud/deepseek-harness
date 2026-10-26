/**
 * A keyed record with no inherited members.
 *
 * View keys are host-chosen strings, so `__proto__` must be a storable key:
 * a plain object literal would set a record's prototype instead of adding a
 * view, and spread-built replacements would reintroduce the inherited members.
 * @returns an empty record whose prototype is `null`.
 */
export function blankRecord<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>
}
