import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { findSingleTransitionVia } from "lib/solvers/HighDensitySolver/findSingleTransitionVia"
import { hasViaObstacleCollision } from "lib/solvers/HyperHighDensitySolver/hasViaObstacleCollision"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("P9 forwards the authoritative via-pad rule independently of generic obstacle margins", () => {
  const raw: SimpleRouteJson = {
    layerCount: 8, minTraceWidth: .1, minViaDiameter: .3, minViaHoleDiameter: .15,
    allowBlindAndBuriedVias: false,
    bounds: { minX: .22, maxX: .53, minY: -1, maxY: 1 },
    obstacles: [{ type: "rect", obstacleId: "foreign-pad", center: { x: 0, y: 0 },
      width: .2, height: 2, layers: ["bottom"], connectedTo: ["foreign"],
      circuitJsonMetadata: { pcb_smtpad_id: "foreign-pad" } }],
    connections: [{ name: "net", pointsToConnect: [{ x: .375, y: -.3, layer: "top" },
      { x: .375, y: .3, layer: "inner1" }] }],
  }
  const variants = [
    { fields: {}, expected: .1, expectedGeneric: .15 },
    { fields: { defaultObstacleMargin: .8 }, expected: .1, expectedGeneric: .8 },
    { fields: { minPadEdgeToPadEdgeClearance: .12 }, expected: .12, expectedGeneric: .15 },
    { fields: { minPadEdgeToPadEdgeClearance: 0 }, expected: 0, expectedGeneric: .15 },
    { fields: { minViaEdgeToPadEdgeClearance: 0, minPadEdgeToPadEdgeClearance: .4 }, expected: 0, expectedGeneric: .15 },
    { fields: { minViaEdgeToPadEdgeClearance: .3, minPadEdgeToPadEdgeClearance: .1 }, expected: .3, expectedGeneric: .15 },
  ]
  for (const variant of variants) {
    const original = { ...raw, ...variant.fields }
    const before = JSON.stringify(original)
    const cms = new AutoroutingPipelineSolver9_PreloadedTraceGraph(original)
    Object.assign(cms, {
      portPointPathingSolver: { getOutput: (): any => ({ nodesWithPortPoints: [] }), computeNodePfMap: (): Map<string, number> => new Map() },
      highDensityRouteSolver: { routes: [] },
    })
    const hdr: any = cms.pipelineDef.find((stage) => stage.solverName === "highDensityRouteSolver")!.getConstructorParams(cms)[0]
    const improve: any = cms.pipelineDef.find((stage) => stage.solverName === "highDensityForceImproveSolver")!.getConstructorParams(cms)[0]
    const route = { connectionName: "net", traceThickness: .1, viaDiameter: .3,
      route: [{ x: .375, y: -.3, z: 0 }, { x: .375, y: 0, z: 0 },
        { x: .375, y: 0, z: 1 }, { x: .375, y: .3, z: 1 }], vias: [{ x: .375, y: 0 }] }
    const blocked = variant.expected > .125 + 1e-9
    expect(hasViaObstacleCollision({ ...improve.viaObstacleContext, routes: [route],
      center: { x: 0, y: 0 }, coordinateScale: 1 })).toBe(blocked)
    const location = findSingleTransitionVia({ connectionName: "net", start: { connectionName: "net", x: .375, y: -.3, z: 0 },
      end: { connectionName: "net", x: .375, y: .3, z: 1 }, nominal: { x: .375, y: 0 }, center: { x: 0, y: 0 },
      viaDiameter: .3, traceThickness: .1, context: { obstacles: hdr.obstacles,
        layerCount: 8, allowBlindAndBuriedVias: false, coordinateScale: 1, viaToPadClearance: hdr.viaToPadClearance ?? hdr.obstacleMargin,
        traceToPadClearance: hdr.traceToPadClearance, boardGeometry: { bounds: raw.bounds } } })
    expect(location).toEqual(blocked ? undefined : { x: .375, y: 0 })
    expect(hdr.viaToPadClearance).toBe(variant.expected)
    expect(improve.viaObstacleContext.viaToPadClearance).toBe(variant.expected)
    expect(hdr.obstacleMargin).toBe(variant.expectedGeneric)
    expect(improve.nodeAssignmentMargin).toBe(variant.fields.defaultObstacleMargin ?? .2)
    expect(JSON.stringify(original)).toBe(before)
  }
})
