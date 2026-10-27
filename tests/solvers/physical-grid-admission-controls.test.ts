import { expect, test } from "bun:test"
import { createPhysicalGridGuards } from "../../lib/solvers/HighDensitySolver/createPhysicalGridGuards"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { CompletedCopperWorldIndex } from "../../lib/solvers/HighDensitySolver/completedCopperWorldIndex"
import { createMandatoryPortPointIndex } from "../../lib/solvers/HighDensitySolver/mandatoryPortPointIndex"
import type { SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { HighDensityIntraNodeRoute } from "../../lib/types/high-density-types"
import type { Obstacle } from "../../lib/types/srj-types"

test("physical grid admission covers constructor and final edges, full barrels, world bounds and exact obstacle rules", () => {
  const bounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
  const context: SingleTransitionBoardContext = { obstacles: [], layerCount: 8,
    allowBlindAndBuriedVias: false, coordinateScale: 1, viaToPadClearance: 0.1,
    traceToPadClearance: 0.1, traceToHoleClearance: 0.2, viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1, boardGeometry: { bounds } }
  const makeGuards = (ctx: SingleTransitionBoardContext = context, box = bounds) => createPhysicalGridGuards({
    context: ctx, bounds: box, center: { x: 0, y: 0 }, connectionName: "moving", traceWidth: 0.1, viaDiameter: 0.3,
  })
  const pad: Obstacle = { type: "rect", shape: "circle", center: { x: 0, y: 0 }, width: 0.4, height: 0.4,
    layers: ["top"], zLayers: [0], connectedTo: ["foreign"] }
  const blocked = makeGuards({ ...context, obstacles: [pad] })
  const opts = { connectionName: "moving", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.2,
    bounds, A: { x: -0.8, y: 0, z: 0 }, B: { x: 0.8, y: 0, z: 0 },
    traceThickness: 0.1, viaDiameter: 0.3, layerCount: 8, availableZ: [0], obstacleMargin: 0.1,
    captureSearchDebug: false }
  const legacy = new SingleHighDensityRouteSolver(opts)
  expect(legacy.solved).toBe(true)
  expect(legacy.solvedPath!.route).toEqual([opts.A, opts.B])
  const guarded = new SingleHighDensityRouteSolver({ ...opts, physicalGuards: blocked })
  expect(guarded.solved).toBe(false) // Constructor cannot publish its straight shortcut through the pad.
  expect(guarded.solvedPath).toBeNull()
  guarded.solve()
  expect(guarded.solved).toBe(true)
  expect(guarded.failed).toBe(false)
  expect(guarded.solvedPath!.route.length).toBeGreaterThan(2)
  for (let i = 1; i < guarded.solvedPath!.route.length; i++) {
    expect(blocked.wireAllowed(guarded.solvedPath!.route[i - 1]!, guarded.solvedPath!.route[i]!)).toBe(true)
  }
  expect(opts.A).toEqual({ x: -0.8, y: 0, z: 0 })
  expect(opts.B).toEqual({ x: 0.8, y: 0, z: 0 })

  const small: Obstacle = { ...pad, center: { x: 1.1, y: 0 }, width: 0.05, height: 0.05 }
  const finalGuards = makeGuards({ ...context, obstacles: [small], traceToPadClearance: 0 })
  const a = { x: 1, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  const b = { ...a, x: 1.2, parent: a }
  expect(finalGuards.wireAllowed(a, a)).toBe(true)
  expect(finalGuards.wireAllowed(b, b)).toBe(true)
  expect(finalGuards.wireAllowed(a, b)).toBe(false)
  const finalGrid = new SingleHighDensityRouteSolver({ ...opts, physicalGuards: finalGuards })
  expect(finalGrid.doesPathToParentIntersectObstacle(b)).toBe(true)

  const tiny: Obstacle = { ...pad, center: { x: 0.075, y: 0 }, width: 0.0002, height: 0.0002 }
  const rounding = makeGuards({ ...context, obstacles: [tiny], traceToPadClearance: 0 })
  const exactA = { x: 0.024, y: 0, z: 0 }
  expect(rounding.wireAllowed(exactA, exactA)).toBe(true)
  expect(rounding.wireAllowed({ ...exactA, x: 0.025 }, { ...exactA, x: 0.025 })).toBe(false)
  const roundedGrid = new SingleHighDensityRouteSolver({ ...opts, A: exactA, minDistBetweenEnteringPoints: 0.05,
    physicalGuards: rounding })
  expect(roundedGrid.candidates.peek()!.x).toBe(exactA.x)

  expect(blocked.viaAllowed({ x: 0, y: 0, z: 5 }, 4)).toBe(false) // Physical TOP copper despite logical4->5.
  expect(makeGuards({ ...context, obstacles: [pad], allowBlindAndBuriedVias: true })
    .viaAllowed({ x: 0, y: 0, z: 5 }, 4)).toBe(true)
  expect(blocked.viaAllowed({ x: 0.5, y: 0, z: 5 }, 4)).toBe(true)
  expect(makeGuards({ ...context, obstacles: [pad], viaToPadClearance: 0.3 })
    .viaAllowed({ x: 0.5, y: 0, z: 5 }, 4)).toBe(false)

  const polygon = [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 0 },
    { x: 0, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 2 }]
  const concave = makeGuards({ ...context, boardGeometry: { bounds, outline: polygon, minBoardEdgeClearance: 0.05 } })
  expect(concave.viaAllowed({ x: 0.5, y: 0.5, z: 5 }, 4)).toBe(false)
  expect(concave.viaAllowed({ x: -0.05, y: 0.5, z: 5 }, 4)).toBe(false)
  expect(concave.viaAllowed({ x: -0.3, y: 0.5, z: 5 }, 4)).toBe(true)

  const narrowBounds = { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 }
  const rotated: Obstacle = { ...pad, shape: undefined, center: { x: 0.8, y: 0.8 },
    width: 0.1, height: 2, ccwRotationDegrees: -45 }
  expect(makeGuards({ ...context, obstacles: [rotated] }, narrowBounds)
    .wireAllowed({ x: 0.1, y: 0.1, z: 0 }, { x: 0.1, y: 0.1, z: 0 })).toBe(false)
  const outside: Obstacle = { ...pad, center: { x: 1.6, y: 0 }, width: 0.2, height: 0.2 }
  expect(makeGuards({ ...context, obstacles: [outside], traceToPadClearance: 0.6 },
    { minX: -1, maxX: 1, minY: -1, maxY: 1 })
    .wireAllowed({ x: 0.95, y: 0, z: 0 }, { x: 0.95, y: 0, z: 0 })).toBe(false)
  const hole: Obstacle = { ...pad, connectedTo: [], isNonPlatedHole: true }
  expect(makeGuards({ ...context, obstacles: [hole] })
    .wireAllowed({ x: -0.2, y: 0.4, z: 0 }, { x: 0.2, y: 0.4, z: 0 })).toBe(false)
  expect(makeGuards({ ...context, obstacles: [hole], traceToHoleClearance: 0 })
    .wireAllowed({ x: -0.2, y: 0.4, z: 0 }, { x: 0.2, y: 0.4, z: 0 })).toBe(true)

  const peer: HighDensityIntraNodeRoute = { connectionName: "foreign", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }
  const local = makeGuards({ ...context, routedPeerRoutes: [peer] })
  expect(local.wireAllowed({ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(false)
  expect(local.viaAllowed({ x: 0, y: 0, z: 5 }, 4)).toBe(false)
  const ledger = new CompletedCopperWorldIndex({ layerCount: 8, traceClearance: 0.1,
    allowBlindAndBuriedVias: false, viaHoleDiameter: 0.15 })
  ledger.addRoutes([peer])
  const external = createPhysicalGridGuards({ context: { ...context, routedPeerWorldIndex: ledger },
    bounds, center: { x: 0, y: 0 }, connectionName: "moving", traceWidth: 0.1, viaDiameter: 0.3 })
  expect(external.wireAllowed({ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(false)
  expect(external.viaAllowed({ x: 0, y: 0, z: 5 }, 4)).toBe(false)
  const mandatory = createMandatoryPortPointIndex([{ capacityMeshNodeId: "other-cell", center: { x: 0, y: 0 },
    width: 1, height: 1, portPoints: [{ x: 0, y: 0, z: 0, connectionName: "foreign" }] }])
  const fixed = makeGuards({ ...context, mandatoryPortPointIndex: mandatory })
  expect(fixed.wireAllowed({ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(false)
  expect(fixed.viaAllowed({ x: 0, y: 0, z: 5 }, 4)).toBe(false)
})
