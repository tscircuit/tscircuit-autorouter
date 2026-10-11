import { expect, test } from "bun:test"
import {
  getLocalHighDensityCacheKey,
  getLocalHighDensityServerIndex,
  type LocalHighDensityRequest,
} from "../../scripts/benchmark/localHighDensityProtocol"

test("equal node inputs retain their server CPU across revisions and run namespaces", (): void => {
  const request: LocalHighDensityRequest = {
    autorouterVersion: "0.0.968", cacheVersion: "first-run/sample-1",
    input: { solvePolicy: "test_v1", nodeId: "node-a", coordinates: [1, 2, 3] },
  }
  const serverIndex = getLocalHighDensityServerIndex(request, 8)
  const alternatives: LocalHighDensityRequest[] = [
    { ...request, autorouterVersion: "0.0.969" },
    { ...request, cacheVersion: "second-run/sample-1" },
    { ...request, autorouterVersion: "0.0.969", cacheVersion: "third-run/sample-1" },
    { ...request, cacheVersion: undefined },
  ]
  for (const alternative of alternatives) {
    expect(getLocalHighDensityServerIndex(alternative, 8)).toBe(serverIndex)
    expect(getLocalHighDensityCacheKey(alternative)).not.toBe(getLocalHighDensityCacheKey(request))
  }
  expect(getLocalHighDensityServerIndex({ ...request, input: { coordinates: [1, 2, 3], nodeId: "node-a", solvePolicy: "test_v1" } }, 8)).toBe(serverIndex)
  expect(getLocalHighDensityServerIndex({ ...request, input: { ...request.input, nodeId: "node-b" } }, 8)).not.toBe(serverIndex)
})
