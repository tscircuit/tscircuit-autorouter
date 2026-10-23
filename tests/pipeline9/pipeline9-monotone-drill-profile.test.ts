import { expect, test } from "bun:test"
import { constructPipeline9MonotoneFamily } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9MonotoneFamily"

test("actual large drill gap changes the affine spacing domain and applies to same-net distinct sites", () => {
  const node = { capacityMeshNodeId: "cell", center: { x: 0, y: 0 }, width: 20, height: 6, portPoints: [-0.4, 0, 0.4].flatMap((y, i) => [{ x: -10, y, z: 0, connectionName: `n${i}` }, { x: 10, y, z: 1, connectionName: `n${i}` }]) }
  const base = { node, traceWidth: 0.15, clearance: 0.15, viaDiameter: 0.6, viaHoleDiameter: 0.3, viaHoleClearance: 0.1, obstacles: [], layerCount: 2, scenePorts: [], sceneRoutes: [], cache: new Map() }
  expect(constructPipeline9MonotoneFamily(base).applicable).toBe(true)
  const large = constructPipeline9MonotoneFamily({ ...base, viaHoleClearance: 1.2 })
  expect(large.applicable).toBe(true)
  expect(large.stats.monotoneFamilyDrillPitchActiveCells).toBe(1)
  const vias = large.routes.flatMap((route) => route.vias)
  for (let i = 1; i < vias.length; i++) expect(Math.hypot(vias[i]!.x - vias[i - 1]!.x, vias[i]!.y - vias[i - 1]!.y)).toBeGreaterThanOrEqual(1.5)
  expect(constructPipeline9MonotoneFamily({ ...base, viaHoleClearance: 3 }).applicable).toBe(false)
  expect(constructPipeline9MonotoneFamily({ ...base, viaHoleDiameter: undefined }).stats.monotoneFamilyUnsupportedDrillRuleCells).toBe(1)
  expect(constructPipeline9MonotoneFamily({ ...base, unsupportedDrillScene: true }).stats.monotoneFamilyUnsupportedDrillSceneCells).toBe(1)
  const single = { ...node, portPoints: [{ x: -10, y: 0, z: 0, connectionName: "task", rootConnectionName: "shared" }, { x: 10, y: 0, z: 1, connectionName: "task", rootConnectionName: "shared" }] }
  const other = { connectionName: "other-task", rootConnectionName: "shared", traceThickness: 0.15, viaDiameter: 0.6, vias: [{ x: 0, y: 1 }], route: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }] }
  expect(constructPipeline9MonotoneFamily({ ...base, node: single, viaHoleClearance: 1.2, sceneRoutes: [other] }).applicable).toBe(false)
  const reused = { ...other, vias: [{ x: 0, y: 0 }], route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }] }
  expect(constructPipeline9MonotoneFamily({ ...base, node: single, viaHoleClearance: 1.2, sceneRoutes: [reused] }).applicable).toBe(true)
})
