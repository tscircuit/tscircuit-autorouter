import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getOwnedStraightRoutePreflightBoardRules } from "lib/solvers/HyperHighDensitySolver/getCertifiedStraightIntraNodeRoutes"
import { loadScenarioBySampleNumber } from "../scripts/benchmark/scenarios"

const makeParams = (): Pipeline9HighDensitySolverParams => ({
  nodePortPoints: [{ capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: [{ x: -2, y: 0, z: 0, connectionName: "a" }, { x: 2, y: 0, z: 0, connectionName: "a" }] }],
  fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [],
  boardGeometry: { bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 } },
  layerCount: 2, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1,
})

test("new board rule context reads own plain values and defers all accessor-backed inputs", async () => {
  let calls = 0
  const accessorSrj = { get minTraceToHoleEdgeClearance(): number { calls++; return 0.4 } }
  expect(getOwnedStraightRoutePreflightBoardRules(accessorSrj)).toBeUndefined()
  expect(calls).toBe(0)
  const inherited = Object.create(accessorSrj)
  expect(getOwnedStraightRoutePreflightBoardRules(inherited)).toBeUndefined()
  expect(calls).toBe(0)
  expect(getOwnedStraightRoutePreflightBoardRules({ minTraceToPadEdgeClearance: "0.2" })).toBeUndefined()
  expect(getOwnedStraightRoutePreflightBoardRules({ minTraceToHoleEdgeClearance: -1 })).toBeUndefined()
  expect(getOwnedStraightRoutePreflightBoardRules({ minTraceToHoleEdgeClearance: 0.4, minTraceToPadEdgeClearance: 0.3 })).toEqual({ minTraceToHoleEdgeClearance: 0.4, minTraceToPadEdgeClearance: 0.3 })
  for (const sample of [4, 16]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
    const rules = getOwnedStraightRoutePreflightBoardRules(scenario)!
    expect(rules).toBeDefined()
    expect(rules.minTraceToHoleEdgeClearance).toBe(scenario.minTraceToHoleEdgeClearance)
    expect(rules.minTraceToPadEdgeClearance).toBe(scenario.minTraceToPadEdgeClearance)
  }
  const params = makeParams()
  Object.defineProperty(params, "minTraceToHoleEdgeClearance", { get: () => { calls++; return 0.4 } })
  const native = new Pipeline9HighDensitySolver(params)
  expect(calls).toBe(0)
  expect(native.allowStraightRoutePreflight).toBe(false)
  native.step()
  expect(native.activeRegularSolver!.straightRoutePreflightContext).toBeUndefined()
  expect(calls).toBe(0)
  const disabled = new Pipeline9HighDensitySolver({ ...makeParams(), allowStraightRoutePreflight: false })
  disabled.step()
  expect(disabled.activeRegularSolver!.straightRoutePreflightContext).toBeUndefined()
  const plain = new Pipeline9HighDensitySolver({ ...makeParams(), minTraceToHoleEdgeClearance: 0.4, minTraceToPadEdgeClearance: 0.3, allowStraightRoutePreflight: true })
  plain.step()
  expect(plain.activeRegularSolver!.straightRoutePreflightContext!.minTraceToHoleEdgeClearance).toBe(0.4)
  expect(plain.activeRegularSolver!.straightRoutePreflightContext!.minTraceToPadEdgeClearance).toBe(0.3)
  expect(calls).toBe(0)
})
