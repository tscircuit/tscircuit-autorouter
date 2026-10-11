import { expect, test } from "bun:test"
import {
  canonicalLocalHighDensityJson,
  getLocalHighDensityCacheKey,
  normalizeLocalHighDensityJson,
  parseLocalHighDensityRequest,
  type LocalHighDensityObject,
} from "../../scripts/benchmark/localHighDensityProtocol"

test("local protocol keys full canonical inputs without losing special IDs or ordered routes", () => {
  const input = JSON.parse('{"solvePolicy":"test_v1","connectivityNetMap":{"__proto__":["a","b"]},"routes":[{"id":"second"},{"id":"first"}]}') as LocalHighDensityObject
  const normalized = normalizeLocalHighDensityJson(input)
  expect(normalized).toEqual(input)
  expect(Object.hasOwn((normalized as LocalHighDensityObject).connectivityNetMap as object, "__proto__")).toBe(true)
  const envelope = { autorouterVersion: "0.0.968", cacheVersion: "run/sample-1", input }
  const key = getLocalHighDensityCacheKey(envelope)
  expect(getLocalHighDensityCacheKey({ ...envelope, input: { routes: input.routes, connectivityNetMap: input.connectivityNetMap, solvePolicy: input.solvePolicy } })).toBe(key)
  expect(getLocalHighDensityCacheKey({ ...envelope, cacheVersion: "run/sample-2" })).not.toBe(key)
  expect(getLocalHighDensityCacheKey({ ...envelope, autorouterVersion: "0.0.969" })).not.toBe(key)
  expect(getLocalHighDensityCacheKey({ ...envelope, input: { ...input, routes: [...input.routes as LocalHighDensityObject[]].reverse() } })).not.toBe(key)
  expect(getLocalHighDensityCacheKey({ ...envelope, input: { ...input, connectivityNetMap: {} } })).not.toBe(key)
  expect(parseLocalHighDensityRequest(envelope, "0.0.968", false)).toEqual(envelope)
  for (const invalid of [
    { ...envelope, autorouterVersion: "wrong" },
    { ...envelope, cacheVersion: "" },
    { ...envelope, unsupported: true },
    { ...envelope, input: null },
  ]) expect(() => parseLocalHighDensityRequest(invalid, "0.0.968", false)).toThrow()
  expect(() => parseLocalHighDensityRequest({ autorouterVersion: "0.0.968", items: [{ requestId: "duplicate", input }, { requestId: "duplicate", input }] }, "0.0.968", true)).toThrow("unique")
  expect(normalizeLocalHighDensityJson({ keep: true, omit: undefined })).toEqual({ keep: true })
  expect(() => normalizeLocalHighDensityJson({ invalid: Number.NaN })).toThrow()
  expect(canonicalLocalHighDensityJson(input)).toContain('"__proto__":["a","b"]')
})
