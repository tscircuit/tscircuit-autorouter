import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constructPipeline9MonotoneFamily } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9MonotoneFamily"
import type { Obstacle } from "../../lib/types/srj-types"

test("owned wire contact is explicit while alias-like canonical keys cannot hide a foreign pad", () => {
  const connMap = new ConnectivityMap({ connectivity_net0: ["wire", "own-pad"], connectivity_net1: ["connectivity_net0", "other-wire", "foreign-pad"] })
  const node = { capacityMeshNodeId: "cell", center: { x: 0, y: 0 }, width: 4, height: 4, portPoints: [{ x: -2, y: 0, z: 0, connectionName: "wire", rootConnectionName: "connectivity_net0" }, { x: 2, y: 0, z: 0, connectionName: "wire", rootConnectionName: "connectivity_net0" }] }
  const obstacle: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["foreign-pad", "connectivity_net0"] }
  const base = { node, connMap, traceWidth: 0.1, clearance: 0.15, viaDiameter: 0.3, obstacles: [obstacle], layerCount: 2, scenePorts: node.portPoints, sceneRoutes: [], cache: new Map() }
  const foreign = constructPipeline9MonotoneFamily(base)
  expect(foreign.applicable).toBe(false)
  expect(foreign.stats.monotoneFamilyPhysicalDomainRejectedCells).toBe(1)
  const own = constructPipeline9MonotoneFamily({ ...base, obstacles: [{ ...obstacle, connectedTo: ["own-pad", "wire", "connectivity_net0"] }] })
  expect(own.applicable).toBe(true)
  expect(own.stats.monotoneFamilyOwnedWireExemptions).toBeGreaterThan(0)
  expect(constructPipeline9MonotoneFamily({ ...base, obstacles: [{ ...obstacle, isNonPlatedHole: true, connectedTo: ["own-pad"] }] }).applicable).toBe(false)
})
