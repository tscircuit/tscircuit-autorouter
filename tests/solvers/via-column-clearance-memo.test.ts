import {
  distance,
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import { expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import type {
  MHPoint2,
  PolyLine2,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { SimpleRouteJson } from "lib/types"

function computeReferenceMinGaps(
  polyLines: PolyLine2[],
  availableZ: number[],
  traceWidth: number,
  viaDiameter: number,
): number[] {
  const minGaps: number[] = []
  for (let i = 0; i < polyLines.length; i++) {
    const line1 = polyLines[i]!
    const path1: MHPoint2[] = [line1.start, ...line1.mPoints, line1.end]
    const vias1 = path1.filter((point) => point.z1 !== point.z2)
    for (let j = i + 1; j < polyLines.length; j++) {
      const line2 = polyLines[j]!
      const path2: MHPoint2[] = [line2.start, ...line2.mPoints, line2.end]
      const vias2 = path2.filter((point) => point.z1 !== point.z2)
      let minGap = 1
      for (const zLayer of availableZ) {
        const segs1: [MHPoint2, MHPoint2][] = []
        const segs2: [MHPoint2, MHPoint2][] = []
        for (let index = 0; index < path1.length - 1; index++) {
          if (path1[index]!.z2 === zLayer) {
            segs1.push([path1[index]!, path1[index + 1]!])
          }
        }
        for (let index = 0; index < path2.length - 1; index++) {
          if (path2[index]!.z2 === zLayer) {
            segs2.push([path2[index]!, path2[index + 1]!])
          }
        }
        for (const seg1 of segs1) {
          for (const seg2 of segs2) {
            minGap = Math.min(
              minGap,
              segmentToSegmentMinDistance(seg1[0], seg1[1], seg2[0], seg2[1]) -
                traceWidth,
            )
          }
        }
        for (const via of vias1) {
          for (const seg of segs2) {
            minGap = Math.min(
              minGap,
              pointToSegmentDistance(via, seg[0], seg[1]) -
                traceWidth / 2 -
                viaDiameter / 2,
            )
          }
        }
        for (const via of vias2) {
          for (const seg of segs1) {
            minGap = Math.min(
              minGap,
              pointToSegmentDistance(via, seg[0], seg[1]) -
                traceWidth / 2 -
                viaDiameter / 2,
            )
          }
        }
        for (const via1 of vias1) {
          for (const via2 of vias2) {
            minGap = Math.min(minGap, distance(via1, via2) - viaDiameter)
          }
        }
      }
      minGaps.push(minGap)
    }
  }
  return minGaps
}

test("memoizes 2D via column clearance across layers while preserving path-via conflicts, invalidation, min-gap parity, and Pipeline9 debug defaults", (): void => {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "net_active",
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -1.5, y: -1.5, z: 0 },
    B: { x: 1.5, y: 1.5, z: 3 },
    layerCount: 4,
    obstacleRoutes: [
      {
        connectionName: "net_obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: -1.2, y: -1.2, z: 1 },
          { x: -1.2, y: 1.2, z: 1 },
        ],
        vias: [{ x: 1.2, y: 0 }],
      },
    ],
    futureConnections: [
      {
        connectionName: "net_future",
        points: [
          { x: 0, y: 1.2, z: 0 },
          { x: 0.8, y: 1.2, z: 2 },
        ],
      },
    ],
    captureSearchDebug: false,
  })

  const segmentSearchSpy = spyOn(solver.obstacleSegmentIndex!, "search")
  const viaSearchSpy = spyOn(solver.obstacleViaIndex!, "search")
  const futureSegmentsSpy = spyOn(
    solver.getFutureConnectionSegments(),
    Symbol.iterator,
  )
  try {
    solver.exploredNodes.clear()
    const freeColumnNodeZ0: Node = {
      x: 0,
      y: 0,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    const z0ViaNeighbors = solver
      .getNeighbors(freeColumnNodeZ0)
      .filter((neighbor) => neighbor.z !== 0)
    expect(z0ViaNeighbors.length).toBe(3)
    // 1 search across all 3 via neighbors (planar neighbors use obstacleSegmentIndexByLayer).
    expect(segmentSearchSpy).toHaveBeenCalledTimes(1)
    // 8 planar neighbor checks + 1 shared via column check (instead of 8 + 3 = 11).
    expect(viaSearchSpy).toHaveBeenCalledTimes(9)
    expect(futureSegmentsSpy).toHaveBeenCalledTimes(1)

    // Exploring the exact same (x, y) column from another layer reuses all 2D via memos (+0 via searches).
    solver.exploredNodes.clear()
    const freeColumnNodeZ2: Node = {
      x: 0,
      y: 0,
      z: 2,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    const z2ViaNeighbors = solver
      .getNeighbors(freeColumnNodeZ2)
      .filter((neighbor) => neighbor.z !== 2)
    expect(z2ViaNeighbors.length).toBe(3)
    expect(segmentSearchSpy).toHaveBeenCalledTimes(1)
    expect(viaSearchSpy).toHaveBeenCalledTimes(17)
    expect(futureSegmentsSpy).toHaveBeenCalledTimes(1)

    // Path-dependent self-via spacing still rejects a second via near an ancestor via.
    const grandparent: Node = {
      x: 0.05,
      y: 0,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    const parentAfterVia: Node = {
      x: 0.05,
      y: 0,
      z: 1,
      g: 0,
      h: 0,
      f: 0,
      parent: grandparent,
    }
    const childAtCachedFreeColumn: Node = {
      x: 0,
      y: 0,
      z: 2,
      g: 0,
      h: 0,
      f: 0,
      parent: parentAfterVia,
    }
    const viaMargin = solver.viaDiameter / 2 + solver.obstacleMargin / 2
    expect(
      solver.isNodeTooCloseToObstacle(childAtCachedFreeColumn, viaMargin, true),
    ).toBe(true)

    // Coordinates sharing a rounded grid key do not alias cached results.
    const aliasedFree: Node = {
      x: 0.74,
      y: 0,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    const aliasedBlocked: Node = {
      x: 0.76,
      y: 0,
      z: 1,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    expect(Math.round(aliasedFree.x / solver.cellStep)).toBe(
      Math.round(aliasedBlocked.x / solver.cellStep),
    )
    expect(solver.isNodeTooCloseToObstacle(aliasedFree, viaMargin, true)).toBe(
      false,
    )
    expect(
      solver.isNodeTooCloseToObstacle(aliasedBlocked, viaMargin, true),
    ).toBe(true)

    // Parameter and future-connection mutations invalidate the 2D future-via cache.
    const nearFutureTrace: Node = {
      x: 0.4,
      y: 0.75,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    expect(
      solver.isNodeTooCloseToObstacle(nearFutureTrace, viaMargin, true),
    ).toBe(false)
    solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.3
    expect(
      solver.isNodeTooCloseToObstacle(nearFutureTrace, viaMargin, true),
    ).toBe(true)
    solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.1
    expect(
      solver.isNodeTooCloseToObstacle(nearFutureTrace, viaMargin, true),
    ).toBe(false)
  } finally {
    futureSegmentsSpy.mockRestore()
    segmentSearchSpy.mockRestore()
    viaSearchSpy.mockRestore()
  }

  // Verify MultiHeadPolyLineIntraNodeSolver.computeMinGapBtwPolyLines exact float parity across 4 layers.
  const mhSolver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "min-gap-parity",
      center: { x: 0, y: 0 },
      width: 6,
      height: 6,
      availableZ: [0, 1, 2, 3],
      portPoints: [],
    },
    viaDiameter: 0.3,
  })
  const sampleLines: PolyLine2[] = [
    {
      connectionName: "c1",
      start: { x: -2, y: -1, z1: 0, z2: 0 },
      end: { x: 2, y: 1, z1: 3, z2: 3 },
      mPoints: [
        { x: -0.4, y: -0.2, z1: 0, z2: 2 },
        { x: 0.5, y: 0.3, z1: 2, z2: 3 },
      ],
    },
    {
      connectionName: "c2",
      start: { x: -2, y: 1, z1: 2, z2: 2 },
      end: { x: 2, y: -1, z1: 0, z2: 0 },
      mPoints: [
        { x: -0.2, y: 0.1, z1: 2, z2: 0 },
        { x: 0.6, y: -0.25, z1: 0, z2: 0 },
      ],
    },
    {
      connectionName: "c3",
      start: { x: 0, y: -2, z1: 3, z2: 3 },
      end: { x: 0, y: 2, z1: 1, z2: 1 },
      mPoints: [{ x: 0.45, y: 0.28, z1: 3, z2: 1 }],
    },
  ]
  expect(mhSolver.computeMinGapBtwPolyLines(sampleLines)).toEqual(
    computeReferenceMinGaps(
      sampleLines,
      mhSolver.availableZ,
      mhSolver.traceWidth,
      mhSolver.viaDiameter,
    ),
  )

  // Verify Pipeline9 defaults highDensityRouteSolver captureSearchDebug to false unless requested.
  const minimalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "conn1",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const defaultPipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    minimalSrj,
    { cacheProvider: null },
  )
  let sawDisabledRegularCapture = false
  while (!defaultPipeline.solved && !defaultPipeline.failed) {
    defaultPipeline.step()
    if (defaultPipeline.highDensityRouteSolver?.activeRegularSolver) {
      expect(
        defaultPipeline.highDensityRouteSolver.activeRegularSolver
          .captureSearchDebug,
      ).toBe(false)
      sawDisabledRegularCapture = true
    }
  }
  expect(defaultPipeline.solved).toBe(true)
  expect(sawDisabledRegularCapture).toBe(true)
})
