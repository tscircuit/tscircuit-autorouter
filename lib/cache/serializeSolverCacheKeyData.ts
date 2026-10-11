export type SolverCacheKeyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SolverCacheKeyValue[]
  | { [key: string]: SolverCacheKeyValue }

/** Matches object-hash's ordered, respectType:false encoding for solver data. */
export function serializeSolverCacheKeyData(
  value: SolverCacheKeyValue,
): string {
  const parts: string[] = []
  const objectIndices = new Map<object, number>()

  const append = (entry: SolverCacheKeyValue): void => {
    if (entry === null) {
      parts.push("Null")
      return
    }
    switch (typeof entry) {
      case "undefined":
        parts.push("Undefined")
        return
      case "string":
        parts.push(`string:${entry.length}:${entry}`)
        return
      case "number":
        parts.push(`number:${entry.toString()}`)
        return
      case "boolean":
        parts.push(`bool:${entry.toString()}`)
        return
      case "object": {
        const objectIndex = objectIndices.get(entry)
        if (objectIndex !== undefined) {
          const reference = `[CIRCULAR:${objectIndex}]`
          parts.push(`string:${reference.length}:${reference}`)
          return
        }
        objectIndices.set(entry, objectIndices.size)
        if (Array.isArray(entry)) {
          parts.push(`array:${entry.length}:`)
          entry.forEach(append)
          return
        }
        const keys = Object.keys(entry)
        parts.push(`object:${keys.length}:`)
        for (const key of keys) {
          parts.push(`string:${key.length}:${key}:`)
          append(entry[key])
          parts.push(",")
        }
        return
      }
      default:
        throw new Error("Unsupported value in solver cache key data")
    }
  }

  append(value)
  return parts.join("")
}
