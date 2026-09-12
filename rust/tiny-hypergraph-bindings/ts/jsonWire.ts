import type { JsonInput, JsonOutput, ReadonlyInput, SpecialNumber } from "../pkg/tiny_hypergraph_bindings.js"

export type UndefinedFromNull<T> = T extends null ? undefined : T extends object
  ? { [K in keyof T]: UndefinedFromNull<T[K]> } : T

export function encodeJsonInput<T>(value: T): JsonInput<T> {
  const numbers: SpecialNumber[] = []
  function encode(current: unknown, path: string[]): unknown {
    if (current === undefined) return null
    if (typeof current === "string") return current.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
    if (typeof current === "bigint") {
      numbers.push({ path, value: `BigInt:${current}` })
      return null
    }
    if (typeof current === "number" && Number.isInteger(current) && !Number.isSafeInteger(current)) {
      numbers.push({ path, value: `Number:${current}` })
      return null
    }
    if (typeof current === "number" && (!Number.isFinite(current) || Object.is(current, -0))) {
      numbers.push({ path, value: Object.is(current, -0) ? "-0" : String(current) })
      return null
    }
    if (Array.isArray(current) || current instanceof Int8Array || current instanceof Int32Array || current instanceof Float64Array) {
      return Array.from(current, (item, index) => encode(item, [...path, String(index)]))
    }
    if (current !== null && typeof current === "object") {
      const entries = current instanceof Map ? current.entries() : Object.entries(current)
      return Object.fromEntries(Array.from(entries, ([key, item]) => {
        if (typeof key !== "string") throw new Error("JSON metadata keys must be strings")
        const encodedKey = key.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
        return [encodedKey, encode(item, [...path, encodedKey])]
      }))
    }
    return current
  }
  // The numeric paths restore the original value before Rust deserializes T.
  return { value: encode(value, []) as ReadonlyInput<T>, numbers }
}

export function decodeJsonOutput<T>(output: JsonOutput<T>): T {
  for (const { path, value } of output.numbers) {
    let target: unknown = output
    let key = "value"
    for (const part of path) {
      if (target === null || typeof target !== "object") throw new Error("Invalid JSON numeric path")
      target = Reflect.get(target, key)
      key = part
    }
    if (target === null || typeof target !== "object") throw new Error("Invalid JSON numeric target")
    const number = value === "-0" ? -0 : Number(value)
    Reflect.set(target, key, number)
  }
  return output.value
}

export function decodeUndefinedJsonOutput<T>(output: JsonOutput<T>): UndefinedFromNull<T> {
  const value = decodeJsonOutput(output)
  function restore(current: unknown): unknown {
    if (current === null) return undefined
    if (typeof current === "object" && current !== null) {
      for (const key of Object.keys(current)) {
        Reflect.set(current, key, restore(Reflect.get(current, key)))
      }
    }
    return current
  }
  // The mapped type describes the old serde-wasm-bindgen null representation.
  return restore(value) as UndefinedFromNull<T>
}
