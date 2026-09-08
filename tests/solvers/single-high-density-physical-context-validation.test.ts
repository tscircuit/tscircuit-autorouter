import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  SingleHighDensityRouteSolver,
  type SingleRoutePhysicalClearanceContext,
} from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("physical context rejects invalid transforms and rules and fails blocked exact terminals without moving them", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.05,
  })
  const context: SingleRoutePhysicalClearanceContext = {
    traceClearanceIndex: index,
    viaClearanceIndex: index,
    traceToTraceClearance: 0.1,
    viaToTraceClearance: 0.1,
    canonicalNetId: "route-net",
    solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
  }
  const opts: ConstructorParameters<typeof SingleHighDensityRouteSolver>[0] = {
    connectionName: "route-net",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    A: { x: 0, y: 0, z: 0 },
    B: { x: 0.5, y: 0, z: 0 },
    traceThickness: 0.1,
  }
  const originalOpts = structuredClone(opts)
  const invalidContexts: SingleRoutePhysicalClearanceContext[] = [
    { ...context, canonicalNetId: "" },
    {
      ...context,
      solveToPhysicalTransform: { center: { x: Number.NaN, y: 0 }, scale: 1 },
    },
    ...[0, -1, Number.NaN, Number.POSITIVE_INFINITY].map(
      (scale: number): SingleRoutePhysicalClearanceContext => ({
        ...context,
        solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale },
      }),
    ),
    ...[
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ].flatMap(
      (clearance: number): SingleRoutePhysicalClearanceContext[] => [
        { ...context, traceToTraceClearance: clearance },
        { ...context, viaToTraceClearance: clearance },
      ],
    ),
  ]
  for (const physicalClearanceContext of invalidContexts) {
    expect((): void => {
      new SingleHighDensityRouteSolver({ ...opts, physicalClearanceContext })
    }).toThrow("invalid physical clearance context")
  }
  for (const field of [
    "traceToTraceClearance",
    "viaToTraceClearance",
  ] as const) {
    const missingRule = { ...context }
    expect(Reflect.deleteProperty(missingRule, field)).toBeTrue()
    expect((): void => {
      new SingleHighDensityRouteSolver({
        ...opts,
        physicalClearanceContext: missingRule,
      })
    }).toThrow("invalid physical clearance context")
  }
  const blocked = new SingleHighDensityRouteSolver({
    ...opts,
    physicalClearanceContext: context,
  })
  expect(blocked.failed).toBeTrue()
  expect(blocked.solved).toBeFalse()
  expect(blocked.solvedPath).toBeNull()
  expect(blocked.error).toContain('Connection "route-net"')
  expect(blocked.error).toContain("terminal")
  expect(blocked.A).toEqual(originalOpts.A)
  expect(blocked.B).toEqual(originalOpts.B)
  const ownPad = new SingleHighDensityRouteSolver({
    ...opts,
    physicalClearanceContext: { ...context, canonicalNetId: "pad-net" },
  })
  expect(ownPad.solved).toBeTrue()
  expect(ownPad.failed).toBeFalse()
  const zeroClearance = new SingleHighDensityRouteSolver({
    ...opts,
    physicalClearanceContext: {
      ...context,
      canonicalNetId: "pad-net",
      traceToTraceClearance: 0,
      viaToTraceClearance: 0,
    },
  })
  expect(zeroClearance.failed).toBeFalse()
  expect(zeroClearance.solved).toBeTrue()
  const legacy = new SingleHighDensityRouteSolver(opts)
  expect(legacy.solved).toBeTrue()
  expect(legacy.failed).toBeFalse()
  expect(opts).toEqual(originalOpts)
})
