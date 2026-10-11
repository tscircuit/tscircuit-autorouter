import { expect, test } from "bun:test"
import {
  defaultB01Params,
  HighDensitySolverB01,
} from "@tscircuit/high-density-b01"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

// Frozen original mathematical helpers and actual private methods from the
// pinned dependency. They run on separate initialized B01 instances below.
const frozenOracleSource = String.raw`
function applyAffineTransformToPoint(t: any, p: any): { x: number; y: number } {
  return { x: t.a * p.x + t.b * p.y + t.c, y: t.d * p.x + t.e * p.y + t.f }
}
function transformPointToRectLocal(
  point: Point2d,
  rect: ObstacleRectPrimitive,
): Point2d {
  const deltaX = point.x - rect.center.x
  const deltaY = point.y - rect.center.y
  const cosine = Math.cos(-rect.rotationRadians)
  const sine = Math.sin(-rect.rotationRadians)
  return {
    x: deltaX * cosine - deltaY * sine,
    y: deltaX * sine + deltaY * cosine,
  }
}

function getRectLocalBounds(rect: ObstacleRectPrimitive): RectBounds {
  return {
    minX: -rect.width / 2,
    minY: -rect.height / 2,
    maxX: rect.width / 2,
    maxY: rect.height / 2,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pushUnique(arr: number[], value: number) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === value) return
  }
  arr.push(value)
}

function pushUniqueNeighbor(arr: NeighborEdge[], edge: NeighborEdge) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]!.cellId === edge.cellId) return
  }
  arr.push(edge)
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  r: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  const qx = clamp(cx, minX, maxX)
  const qy = clamp(cy, minY, maxY)
  const dx = cx - qx
  const dy = cy - qy
  return dx * dx + dy * dy <= r * r
}

function getSquaredDistanceFromPointToSegment(params: {
  point: Point2d
  segmentStart: Point2d
  segmentEnd: Point2d
}): number {
  const segmentDx = params.segmentEnd.x - params.segmentStart.x
  const segmentDy = params.segmentEnd.y - params.segmentStart.y
  const segmentLengthSquared = segmentDx ** 2 + segmentDy ** 2
  if (segmentLengthSquared === 0) {
    return (
      (params.point.x - params.segmentStart.x) ** 2 +
      (params.point.y - params.segmentStart.y) ** 2
    )
  }
  const projection = clamp(
    ((params.point.x - params.segmentStart.x) * segmentDx +
      (params.point.y - params.segmentStart.y) * segmentDy) /
      segmentLengthSquared,
    0,
    1,
  )
  const closestX = params.segmentStart.x + projection * segmentDx
  const closestY = params.segmentStart.y + projection * segmentDy
  return (params.point.x - closestX) ** 2 + (params.point.y - closestY) ** 2
}

function getSquaredDistanceFromPointToRect(params: {
  point: Point2d
  rect: RectBounds
}): number {
  const nearestX = clamp(params.point.x, params.rect.minX, params.rect.maxX)
  const nearestY = clamp(params.point.y, params.rect.minY, params.rect.maxY)
  const dx = params.point.x - nearestX
  const dy = params.point.y - nearestY
  return dx * dx + dy * dy
}

function getOrientation(params: {
  first: Point2d
  second: Point2d
  third: Point2d
}): number {
  return (
    (params.second.x - params.first.x) * (params.third.y - params.first.y) -
    (params.second.y - params.first.y) * (params.third.x - params.first.x)
  )
}

function isPointOnSegment(params: {
  point: Point2d
  segmentStart: Point2d
  segmentEnd: Point2d
}): boolean {
  const epsilon = 1e-9
  if (
    Math.abs(
      getOrientation({
        first: params.segmentStart,
        second: params.segmentEnd,
        third: params.point,
      }),
    ) > epsilon
  ) {
    return false
  }
  return (
    params.point.x >= Math.min(params.segmentStart.x, params.segmentEnd.x) &&
    params.point.x <= Math.max(params.segmentStart.x, params.segmentEnd.x) &&
    params.point.y >= Math.min(params.segmentStart.y, params.segmentEnd.y) &&
    params.point.y <= Math.max(params.segmentStart.y, params.segmentEnd.y)
  )
}

function doSegmentsIntersect(params: {
  firstStart: Point2d
  firstEnd: Point2d
  secondStart: Point2d
  secondEnd: Point2d
}): boolean {
  const firstStartSide = getOrientation({
    first: params.firstStart,
    second: params.firstEnd,
    third: params.secondStart,
  })
  const firstEndSide = getOrientation({
    first: params.firstStart,
    second: params.firstEnd,
    third: params.secondEnd,
  })
  const secondStartSide = getOrientation({
    first: params.secondStart,
    second: params.secondEnd,
    third: params.firstStart,
  })
  const secondEndSide = getOrientation({
    first: params.secondStart,
    second: params.secondEnd,
    third: params.firstEnd,
  })

  if (
    firstStartSide * firstEndSide < 0 &&
    secondStartSide * secondEndSide < 0
  ) {
    return true
  }
  return (
    isPointOnSegment({
      point: params.secondStart,
      segmentStart: params.firstStart,
      segmentEnd: params.firstEnd,
    }) ||
    isPointOnSegment({
      point: params.secondEnd,
      segmentStart: params.firstStart,
      segmentEnd: params.firstEnd,
    }) ||
    isPointOnSegment({
      point: params.firstStart,
      segmentStart: params.secondStart,
      segmentEnd: params.secondEnd,
    }) ||
    isPointOnSegment({
      point: params.firstEnd,
      segmentStart: params.secondStart,
      segmentEnd: params.secondEnd,
    })
  )
}

function getSquaredDistanceBetweenSegments(params: {
  firstStart: Point2d
  firstEnd: Point2d
  secondStart: Point2d
  secondEnd: Point2d
}): number {
  if (doSegmentsIntersect(params)) return 0
  return Math.min(
    getSquaredDistanceFromPointToSegment({
      point: params.firstStart,
      segmentStart: params.secondStart,
      segmentEnd: params.secondEnd,
    }),
    getSquaredDistanceFromPointToSegment({
      point: params.firstEnd,
      segmentStart: params.secondStart,
      segmentEnd: params.secondEnd,
    }),
    getSquaredDistanceFromPointToSegment({
      point: params.secondStart,
      segmentStart: params.firstStart,
      segmentEnd: params.firstEnd,
    }),
    getSquaredDistanceFromPointToSegment({
      point: params.secondEnd,
      segmentStart: params.firstStart,
      segmentEnd: params.firstEnd,
    }),
  )
}

function doesSegmentIntersectRect(params: {
  segmentStart: Point2d
  segmentEnd: Point2d
  rect: RectBounds
}): boolean {
  if (
    getSquaredDistanceFromPointToRect({
      point: params.segmentStart,
      rect: params.rect,
    }) === 0 ||
    getSquaredDistanceFromPointToRect({
      point: params.segmentEnd,
      rect: params.rect,
    }) === 0
  ) {
    return true
  }
  const corners: Point2d[] = [
    { x: params.rect.minX, y: params.rect.minY },
    { x: params.rect.maxX, y: params.rect.minY },
    { x: params.rect.maxX, y: params.rect.maxY },
    { x: params.rect.minX, y: params.rect.maxY },
  ]
  for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
    const nextCornerIndex = (cornerIndex + 1) % corners.length
    if (
      doSegmentsIntersect({
        firstStart: params.segmentStart,
        firstEnd: params.segmentEnd,
        secondStart: corners[cornerIndex]!,
        secondEnd: corners[nextCornerIndex]!,
      })
    ) {
      return true
    }
  }
  return false
}

function doesCapsuleIntersectRect(params: {
  segmentStart: Point2d
  segmentEnd: Point2d
  radius: number
  rect: RectBounds
}): boolean {
  if (doesSegmentIntersectRect(params)) return true
  const radiusSquared = params.radius ** 2
  if (
    getSquaredDistanceFromPointToRect({
      point: params.segmentStart,
      rect: params.rect,
    }) <= radiusSquared ||
    getSquaredDistanceFromPointToRect({
      point: params.segmentEnd,
      rect: params.rect,
    }) <= radiusSquared
  ) {
    return true
  }
  const corners: Point2d[] = [
    { x: params.rect.minX, y: params.rect.minY },
    { x: params.rect.maxX, y: params.rect.minY },
    { x: params.rect.maxX, y: params.rect.maxY },
    { x: params.rect.minX, y: params.rect.maxY },
  ]
  return corners.some(
    (corner) =>
      getSquaredDistanceFromPointToSegment({
        point: corner,
        segmentStart: params.segmentStart,
        segmentEnd: params.segmentEnd,
      }) <= radiusSquared,
  )
}

function originalLateral(this: any, params: {
    activeConn: ConnId
    layer: number
    fromCellId: number
    toCellId: number
  }): boolean {
    const activeRootConnectionName = this.connIdToRootNet[params.activeConn]
    const activeSegment = this.activeConnSeg
    const segmentStart =
      activeSegment &&
      params.layer === activeSegment.startZ &&
      params.fromCellId === activeSegment.startCellId
        ? activeSegment.startPoint
        : applyAffineTransformToPoint(this.gridToBoundsTransform, {
            x: this.cellCenterX[params.fromCellId]!,
            y: this.cellCenterY[params.fromCellId]!,
          })
    const segmentEnd =
      activeSegment &&
      params.layer === activeSegment.endZ &&
      params.toCellId === activeSegment.endCellId
        ? activeSegment.endPoint
        : applyAffineTransformToPoint(this.gridToBoundsTransform, {
            x: this.cellCenterX[params.toCellId]!,
            y: this.cellCenterY[params.toCellId]!,
          })

    for (const obstacleTrace of this.obstacleTracePrimitives) {
      if (
        obstacleTrace.layer !== params.layer ||
        this.obstacleRootNames[obstacleTrace.rootId] ===
          activeRootConnectionName
      ) {
        continue
      }
      const requiredDistance =
        obstacleTrace.traceRadius +
        this.traceThickness / 2 +
        this.obstacleClearanceMargin
      if (
        getSquaredDistanceBetweenSegments({
          firstStart: segmentStart,
          firstEnd: segmentEnd,
          secondStart: obstacleTrace.segmentStart,
          secondEnd: obstacleTrace.segmentEnd,
        }) <
        requiredDistance * requiredDistance
      ) {
        return true
      }
    }

    for (const obstacleVia of this.obstacleViaPrimitives) {
      if (
        !obstacleVia.layers.includes(params.layer) ||
        this.obstacleRootNames[obstacleVia.rootId] === activeRootConnectionName
      ) {
        continue
      }
      const requiredDistance =
        obstacleVia.viaRadius +
        this.traceThickness / 2 +
        this.obstacleClearanceMargin
      if (
        getSquaredDistanceFromPointToSegment({
          point: obstacleVia.center,
          segmentStart,
          segmentEnd,
        }) <
        requiredDistance * requiredDistance
      ) {
        return true
      }
    }

    for (const obstacleRect of this.obstacleRectPrimitives) {
      if (
        !obstacleRect.layers.includes(params.layer) ||
        this.obstacleRootNames[obstacleRect.rootId] === activeRootConnectionName
      ) {
        continue
      }
      if (
        doesCapsuleIntersectRect({
          segmentStart: transformPointToRectLocal(segmentStart, obstacleRect),
          segmentEnd: transformPointToRectLocal(segmentEnd, obstacleRect),
          radius: this.traceThickness / 2 + this.obstacleClearanceMargin,
          rect: getRectLocalBounds(obstacleRect),
        })
      ) {
        return true
      }
    }
    return false
  }

function originalMove(
    this: any,
    activeConn: ConnId,
    toZ: number,
    fromCellId: number,
    toCellId: number,
    isVia: boolean,
    rippedHead: number,
    currentRipCount: number,
    lateralCost: number,
  ): void {
    let cost = 0
    let head = rippedHead
    let ripCount = currentRipCount
    const toFlatIdx = toZ * this.planeSize + toCellId

    const obstacleRootIds = isVia
      ? this.obstacleViaRootIdsByCell[toCellId]
      : [
          ...(this.obstacleTraceRootIdsFlat[
            toZ * this.planeSize + fromCellId
          ] ?? []),
          ...(this.obstacleTraceRootIdsFlat[toFlatIdx] ?? []),
        ]
    const isBlockedByObstacle =
      this.isBlockedByObstacleRoots(obstacleRootIds, activeConn) &&
      (isVia
        ? this.isViaMoveBlockedByObstacleGeometry({
            activeConn,
            cellId: toCellId,
          })
        : this.isLateralMoveBlockedByObstacleGeometry({
            activeConn,
            layer: toZ,
            fromCellId,
            toCellId,
          }))
    if (isBlockedByObstacle) {
      this._moveCost = -1
      this._moveRippedHead = head
      this._moveRipCount = ripCount
      return
    }
    const usesSameRootObstacle = this.hasSameRootObstacle(
      obstacleRootIds,
      activeConn,
    )

    if (isVia) {
      cost += this.hyperParameters.viaBaseCost
      cost += Math.min(this.penalty2d[toCellId]!, this.penaltyCap)

      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const allowFixedOverlap = this.allowSharedUse(activeConn, fixedOwner)
      const seg = this.activeConnSeg
      const isSegEnd = !!seg && toZ === seg.endZ && toCellId === seg.endCellId
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRippedHead = head
        return
      }

      this.fillViaOccupants(toCellId, activeConn)
      const occs = this._viaOccs
      for (let i = 0; i < occs.length; i++) {
        const occ = occs[i]!
        if (!this.ripChain.contains(head, occ)) {
          cost += this.hyperParameters.ripCost
          head = this.ripChain.append(head, occ)
          ripCount++
        }
        cost += this.hyperParameters.ripViaPenalty
      }
    } else {
      cost += lateralCost
      cost += Math.min(this.penalty2d[toCellId]!, this.penaltyCap)

      const fixedOwner = this.portOwnerFlat[toFlatIdx]!
      const allowFixedOverlap = this.allowSharedUse(activeConn, fixedOwner)
      const seg = this.activeConnSeg
      const isSegEnd = !!seg && toZ === seg.endZ && toCellId === seg.endCellId
      if (
        fixedOwner >= 0 &&
        fixedOwner !== activeConn &&
        !allowFixedOverlap &&
        !isSegEnd
      ) {
        this._moveCost = -1
        this._moveRippedHead = head
        return
      }

      this.fillTraceOccupants(toFlatIdx, activeConn, this._cellOccs)
      for (let i = 0; i < this._cellOccs.length; i++) {
        const occ = this._cellOccs[i]!
        if (!this.ripChain.contains(head, occ)) {
          cost += this.hyperParameters.ripCost
          head = this.ripChain.append(head, occ)
          ripCount++
        }
        cost += this.hyperParameters.ripTracePenalty
      }
    }

    if (usesSameRootObstacle) {
      cost *= this.hyperParameters.sameRootObstacleCostMultiplier
    }
    this._moveCost = cost
    this._moveRippedHead = head
    this._moveRipCount = ripCount
  }

`
const transpiler = new Bun.Transpiler({ loader: "ts" })
const oracle = new Function(
  transpiler.transformSync(frozenOracleSource) +
    "\nreturn { distance: getSquaredDistanceBetweenSegments, lateral: originalLateral, move: originalMove };",
)()

function getCurrentPredicate(): (params: any, distance: number) => boolean {
  const path =
    process.env.B01_TEST_SOURCE_PATH ??
    join(
      dirname(Bun.resolveSync("@tscircuit/high-density-b01", process.cwd())),
      "HighDensitySolverB01/HighDensitySolverB01.ts",
    )
  const source = readFileSync(path, "utf8")
  const helpers = source.slice(
    source.indexOf("function transformPointToRectLocal("),
    source.indexOf("export interface HighDensitySolverB01Props"),
  )
  return new Function(
    transpiler.transformSync(helpers) + "\nreturn areSegmentsCloserThan;",
  )()
}

function makeProps(obstacles: any[] = [], name = "candidate"): any {
  return {
    ...defaultB01Params,
    highResolutionCellSize: 0.2,
    lowResolutionCellSize: 0.4,
    highResolutionCellThickness: 2,
    maxCellCount: 20000,
    obstacleClearanceMargin: 0.15,
    nodeWithPortPoints: {
      capacityMeshNodeId: "b01-distance-gate",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: name, x: -2, y: 0, z: 0 },
        { connectionName: name, x: 2, y: 0, z: 0 },
      ],
    },
    obstacles,
  }
}

function readMoveResult(solver: any): any {
  const rips: number[] = []
  solver.ripChain.collect(solver._moveRippedHead, rips)
  return [solver._moveCost, solver._moveRipCount, rips]
}

test("B01 skips distant projections and root-array allocation without changing exact move costs or routes", () => {
  const predicate = getCurrentPredicate()
  let seed = 81723
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const fixtures: any[] = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0.2 },
      { x: 10, y: 0.2 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ],
    [
      { x: -1000, y: 277.08762483671313 },
      { x: -180.34394562710077, y: 49.971075547494685 },
      { x: 129.70174718648195, y: -35.93874906507412 },
      { x: 1000, y: -277.08762483671313 },
    ],
  ]
  for (const scale of [0, 1e-170, 1e-150, 1, 1e8, 1e9, 1e155]) {
    for (let index = 0; index < 80; index++)
      fixtures.push(
        Array.from({ length: 4 }, (): any => ({
          x: (random() - 0.5) * scale,
          y: (random() - 0.5) * scale,
        })),
      )
  }
  for (const coordinate of [NaN, Infinity, -Infinity, -0, "1"])
    fixtures.push([
      { x: coordinate, y: 0 },
      { x: 1, y: 0 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ])
  const thresholds = [
    0,
    -0,
    0.1,
    0.2,
    0.20000000000000004,
    -0.1,
    1e-170,
    1e9,
    1e155,
    NaN,
    Infinity,
    -Infinity,
  ]
  for (const points of fixtures) {
    const params = {
      firstStart: points[0],
      firstEnd: points[1],
      secondStart: points[2],
      secondEnd: points[3],
    }
    const distance = oracle.distance(params)
    for (const threshold of thresholds)
      expect(predicate(params, threshold)).toBe(
        distance < threshold * threshold,
      )
    const boundary = Math.sqrt(distance)
    if (Number.isFinite(boundary)) {
      const ulp = Math.max(
        Number.MIN_VALUE,
        Math.abs(boundary) * Number.EPSILON,
      )
      for (const threshold of [boundary - ulp, boundary, boundary + ulp])
        expect(predicate(params, threshold)).toBe(
          distance < threshold * threshold,
        )
    }
  }
  const mutable = {
    firstStart: { x: 0, y: 0 },
    firstEnd: { x: 1, y: 0 },
    secondStart: { x: 4, y: 1 },
    secondEnd: { x: 5, y: 1 },
  }
  expect(predicate(mutable, 0.1)).toBe(false)
  mutable.secondStart.x = 0.5
  mutable.secondStart.y = -1
  mutable.secondEnd.x = 0.5
  expect(predicate(mutable, 0.1)).toBe(true)

  const candidate: any = new HighDensitySolverB01(makeProps())
  const reference: any = new HighDensitySolverB01(makeProps())
  candidate._setup()
  reference._setup()
  reference.isLateralMoveBlockedByObstacleGeometry = oracle.lateral
  reference.computeMoveCostAndRips = oracle.move
  for (const solver of [candidate, reference]) {
    solver.connIdToRootNet = ["candidate", "candidate", "foreign"]
    solver.obstacleRootNames = ["candidate", "foreign"]
    solver.activeConnSeg = solver.unsolvedSegs[0]
    solver.hyperParameters.sameRootObstacleCostMultiplier = 0.375
  }
  const fromCellId = Math.floor(candidate.planeSize / 2)
  const toCellId = Math.min(fromCellId + 1, candidate.planeSize - 1)
  for (const fromRoots of [undefined, [], [0], [1], [0, 1]]) {
    for (const toRoots of [undefined, [], [0], [1], [1, 0]]) {
      for (const isVia of [false, true]) {
        for (const owner of [-2, -1, 0, 1, 2]) {
          for (const solver of [candidate, reference]) {
            solver.obstacleTraceRootIdsFlat[fromCellId] = fromRoots
            solver.obstacleTraceRootIdsFlat[toCellId] = toRoots
            solver.obstacleViaRootIdsByCell[toCellId] = toRoots
            solver.portOwnerFlat[toCellId] = owner
            solver.usedCellsFlat[toCellId] = owner >= 0 ? owner : -1
            solver.sharedCellsFlat[toCellId] = [1, 2]
            solver._moveRipCount = 73
            solver.computeMoveCostAndRips(
              0,
              0,
              fromCellId,
              toCellId,
              isVia,
              -1,
              0,
              0.2,
            )
          }
          expect(readMoveResult(candidate)).toEqual(readMoveResult(reference))
        }
      }
    }
  }
  const wall = {
    type: "route",
    connectionName: "wall",
    rootConnectionName: "wall",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -2, z: 0 },
      { x: 0, y: 2, z: 0 },
    ],
    vias: [],
  }
  const sameRootWall = {
    ...wall,
    connectionName: "candidate",
    rootConnectionName: "candidate",
  }
  const rotatedRect = {
    type: "rect",
    connectionName: "pad",
    rootConnectionName: "pad",
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 1.2,
    ccwRotationDegrees: 30,
    zLayers: [0, 1],
  }
  for (const obstacles of [[wall], [sameRootWall], [wall, rotatedRect]]) {
    const a: any = new HighDensitySolverB01(
      makeProps(structuredClone(obstacles)),
    )
    const b: any = new HighDensitySolverB01(
      makeProps(structuredClone(obstacles)),
    )
    b.isLateralMoveBlockedByObstacleGeometry = oracle.lateral
    b.computeMoveCostAndRips = oracle.move
    a.solve()
    b.solve()
    expect(a.solved).toBe(true)
    expect(b.solved).toBe(true)
    expect(a.getOutput()).toEqual(b.getOutput())
    expect(a.iterations).toBe(b.iterations)
  }
})
