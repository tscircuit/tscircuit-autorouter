import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("through vias honor original surface pads while blind vias retain their actual span", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      { name: "signal", pointsToConnect: [{ x: -3, y: 0, layer: "inner1", pcb_port_id: "signal-port" }] },
      { name: "pad-owner", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pad-port" }] },
    ],
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1,
      layers: ["top"], connectedTo: ["pad-port"] }],
  }
  const original = structuredClone(srj)
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: srj,
    derivedConnections: [{ name: "signal-branch", __netConnectionName: "signal", pointsToConnect: [] }] })
  const context = { boardObstacles: srj.obstacles, physicalOwnership, layerCount: 4, clearance: 0.1 }
  const through = getPipeline9ViaPlacementValidator(context)
  const placement = { x: 0, y: 0, zStart: 1, zEnd: 3, viaDiameter: 0.3 }
  expect(through(placement, "signal-branch")).toBe(false)
  expect(through({ ...placement, x: 0.751 }, "signal-branch")).toBe(true)
  expect(through({ ...placement, x: 0.749 }, "signal-branch")).toBe(false)
  expect(through(placement, "pad-owner")).toBe(true)
  expect(through(placement, "unknown-generated-alias")).toBe(false)
  const blind = getPipeline9ViaPlacementValidator({ ...context, allowBlindAndBuriedVias: true })
  expect(blind(placement, "signal-branch")).toBe(true)
  expect(blind({ ...placement, zStart: 0 }, "signal-branch")).toBe(false)
  expect(() => through({ ...placement, viaDiameter: NaN }, "signal-branch")).toThrow()
  expect(srj).toEqual(original)
})
