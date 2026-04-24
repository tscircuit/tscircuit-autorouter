// import { BaseSolver } from "lib/solvers/BaseSolver"
// import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
// import {
//   PREFERRED_VIA_TO_VIA_CLEARANCE,
//   getDrcErrors,
// } from "lib/testing/getDrcErrors"
// import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
// import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
// import type { HighDensityRoute } from "lib/types/high-density-types"
// import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

// type Point = { x: number; y: number }
// type MutableRoute = HighDensityRoute & {
//   route: Array<HighDensityRoute["route"][number]>
//   vias: Array<HighDensityRoute["vias"][number]>
// }
// type ViaNode = {
//   routeIndex: number
//   rootConnectionName: string
//   pointIndexes: number[]
//   x: number
//   y: number
//   radius: number
//   movable: boolean
// }
// type Segment = {
//   routeIndex: number
//   rootConnectionName: string
//   startIndex: number
//   endIndex: number
//   start: Point
//   end: Point
//   z: number
//   radius: number
// }
// type DrcSnapshot = {
//   errors: Array<Record<string, unknown>>
//   count: number
//   issueScore: number
//   traceRouteIndexById: Map<string, number>
// }
// type GlobalDrcForceImproveSolverParams = {
//   srj: SimpleRouteJson
//   hdRoutes: HighDensityRoute[]
//   effort?: number
// }

// const POSITION_EPSILON = 1e-6
// const COORDINATE_EPSILON = 1e-3
// const MAX_ERROR_MOVE = 0.14
// const BASE_MAX_PASSES = 3
// const BASE_MAX_CANDIDATE_ATTEMPTS = 8
// const BASE_MAX_TARGETED_CANDIDATE_ATTEMPTS = 2
// const BROAD_FORCE_PASSES = 6
// const BROAD_MAX_MOVE = 0.035
// const CLEARANCE_SLACK = 0.015
// const VIA_PAIR_REPAIR_MAX_MOVE = 0.16
// const TRACE_PAD_REPAIR_MAX_MOVE = 0.2
// const PREFERRED_TRACE_TO_PAD_CLEARANCE = 0.16
// const FAST_ERROR_FORCE_SCALES = [1, 1.75] as const
// const DEEP_ERROR_FORCE_SCALES = [1, 1.75, -1] as const

// const cloneRoutes = (routes: HighDensityRoute[]): MutableRoute[] =>
//   routes.map((route) => ({
//     ...route,
//     route: route.route.map((point) => ({ ...point })),
//     vias: route.vias.map((via) => ({ ...via })),
//   }))

// const areSameXY = (left: Point, right: Point) =>
//   Math.abs(left.x - right.x) <= COORDINATE_EPSILON &&
//   Math.abs(left.y - right.y) <= COORDINATE_EPSILON

// const getRootConnectionName = (route: HighDensityRoute) =>
//   route.rootConnectionName ?? route.connectionName

// const sharesNet = (left: string, right: string | undefined) =>
//   Boolean(right) && left === right

// const obstacleSharesNet = (
//   rootConnectionName: string,
//   obstacle: SimpleRouteJson["obstacles"][number],
// ) =>
//   (obstacle.connectedTo ?? []).some((connectedTo) =>
//     sharesNet(rootConnectionName, connectedTo),
//   )

// const clampValue = (value: number, minValue: number, maxValue: number) =>
//   Math.max(minValue, Math.min(value, maxValue))

// const clampToBounds = (point: Point, bounds: SimpleRouteJson["bounds"]) => {
//   point.x = clampValue(point.x, bounds.minX, bounds.maxX)
//   point.y = clampValue(point.y, bounds.minY, bounds.maxY)
// }

// const createSimplifiedTraces = (
//   srj: SimpleRouteJson,
//   routes: HighDensityRoute[],
// ): {
//   traces: SimplifiedPcbTraces
//   traceRouteIndexById: Map<string, number>
// } => {
//   const traces: SimplifiedPcbTraces = []
//   const traceRouteIndexById = new Map<string, number>()

//   for (const connection of srj.connections) {
//     const hdRoutes = routes
//       .map((route, routeIndex) => ({ route, routeIndex }))
//       .filter(({ route }) => route.connectionName === connection.name)

//     for (let i = 0; i < hdRoutes.length; i += 1) {
//       const hdRoute = hdRoutes[i]
//       if (!hdRoute) continue
//       const traceId = `${connection.name}_${i}`

//       traces.push({
//         type: "pcb_trace",
//         pcb_trace_id: traceId,
//         connection_name:
//           connection.netConnectionName ??
//           connection.rootConnectionName ??
//           connection.name,
//         route: convertHdRouteToSimplifiedRoute(hdRoute.route, srj.layerCount, {
//           connectionPoints: connection.pointsToConnect,
//         }),
//       })
//       traceRouteIndexById.set(traceId, hdRoute.routeIndex)
//     }
//   }

//   return { traces, traceRouteIndexById }
// }

// const getDrcErrorSeverity = (error: Record<string, unknown>) => {
//   const message = typeof error.message === "string" ? error.message : ""
//   const gapMatch = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
//   const requiredMatch = message.match(/required: (-?\d+(?:\.\d+)?)mm/)
//   if (gapMatch && requiredMatch) {
//     const gap = Number.parseFloat(gapMatch[1]!)
//     const required = Number.parseFloat(requiredMatch[1]!)
//     if (Number.isFinite(gap) && Number.isFinite(required)) {
//       return Math.max(0, required - gap)
//     }
//   }

//   return 1
// }

// const getDrcIssueScore = (errors: Array<Record<string, unknown>>) =>
//   errors.reduce((score, error) => score + getDrcErrorSeverity(error), 0)

// const getDrcSnapshot = (
//   srj: SimpleRouteJson,
//   routes: HighDensityRoute[],
// ): DrcSnapshot => {
//   const { traces, traceRouteIndexById } = createSimplifiedTraces(srj, routes)
//   const drc = getDrcErrors(
//     convertToCircuitJson(srj, traces, srj.minTraceWidth, srj.minViaDiameter),
//     RELAXED_DRC_OPTIONS,
//   )

//   return {
//     errors: drc.errorsWithCenters as unknown as Array<Record<string, unknown>>,
//     count: drc.errors.length,
//     issueScore: getDrcIssueScore(
//       drc.errorsWithCenters as unknown as Array<Record<string, unknown>>,
//     ),
//     traceRouteIndexById,
//   }
// }

// const collectViaNodes = (routes: MutableRoute[]): ViaNode[] => {
//   const vias: ViaNode[] = []

//   for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
//     const route = routes[routeIndex]
//     if (!route) continue
//     const seenIndexes = new Set<number>()

//     for (let index = 0; index < route.route.length - 1; index += 1) {
//       const current = route.route[index]
//       const next = route.route[index + 1]
//       if (!current || !next) continue
//       if (current.z === next.z || !areSameXY(current, next)) continue

//       const pointIndexes = [index, index + 1]
//       for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
//         const point = route.route[cursor]
//         if (!point || !areSameXY(point, current)) break
//         pointIndexes.push(cursor)
//       }
//       for (let cursor = index + 2; cursor < route.route.length; cursor += 1) {
//         const point = route.route[cursor]
//         if (!point || !areSameXY(point, current)) break
//         pointIndexes.push(cursor)
//       }

//       const uniquePointIndexes = [...new Set(pointIndexes)]
//       if (
//         uniquePointIndexes.some((pointIndex) => seenIndexes.has(pointIndex))
//       ) {
//         continue
//       }
//       for (const pointIndex of uniquePointIndexes) {
//         seenIndexes.add(pointIndex)
//       }

//       vias.push({
//         routeIndex,
//         rootConnectionName: getRootConnectionName(route),
//         pointIndexes: uniquePointIndexes,
//         x: current.x,
//         y: current.y,
//         radius: (route.viaDiameter ?? 0.3) / 2,
//         movable:
//           !uniquePointIndexes.includes(0) &&
//           !uniquePointIndexes.includes(route.route.length - 1),
//       })
//     }
//   }

//   return vias
// }

// const collectSegments = (routes: MutableRoute[]): Segment[] => {
//   const segments: Segment[] = []

//   for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
//     const route = routes[routeIndex]
//     if (!route) continue

//     for (let index = 0; index < route.route.length - 1; index += 1) {
//       const start = route.route[index]
//       const end = route.route[index + 1]
//       if (!start || !end) continue
//       if (start.z !== end.z || areSameXY(start, end)) continue
//       segments.push({
//         routeIndex,
//         rootConnectionName: getRootConnectionName(route),
//         startIndex: index,
//         endIndex: index + 1,
//         start,
//         end,
//         z: start.z,
//         radius: (route.traceThickness ?? 0.1) / 2,
//       })
//     }
//   }

//   return segments
// }

// const pointToSegmentProjection = (point: Point, segment: Segment) => {
//   const segmentX = segment.end.x - segment.start.x
//   const segmentY = segment.end.y - segment.start.y
//   const lengthSquared = segmentX * segmentX + segmentY * segmentY
//   if (lengthSquared <= POSITION_EPSILON) {
//     return { x: segment.start.x, y: segment.start.y, t: 0 }
//   }

//   const t = clampValue(
//     ((point.x - segment.start.x) * segmentX +
//       (point.y - segment.start.y) * segmentY) /
//       lengthSquared,
//     0,
//     1,
//   )

//   return {
//     x: segment.start.x + segmentX * t,
//     y: segment.start.y + segmentY * t,
//     t,
//   }
// }

// const getPointToObstacleDistance = (
//   point: Point,
//   obstacle: SimpleRouteJson["obstacles"][number],
// ) => {
//   const halfWidth = obstacle.width / 2
//   const halfHeight = obstacle.height / 2
//   const dx = Math.max(Math.abs(point.x - obstacle.center.x) - halfWidth, 0)
//   const dy = Math.max(Math.abs(point.y - obstacle.center.y) - halfHeight, 0)
//   return Math.hypot(dx, dy)
// }

// const getNearestObstacleNearPoint = (
//   srj: SimpleRouteJson,
//   point: Point,
//   maxDistance = 0.6,
// ) => {
//   let nearestObstacle:
//     | {
//         obstacle: SimpleRouteJson["obstacles"][number]
//         distance: number
//       }
//     | undefined

//   for (const obstacle of srj.obstacles) {
//     const distance = getPointToObstacleDistance(point, obstacle)
//     if (distance > maxDistance) continue
//     if (!nearestObstacle || distance < nearestObstacle.distance) {
//       nearestObstacle = {
//         obstacle,
//         distance,
//       }
//     }
//   }

//   return nearestObstacle?.obstacle
// }

// const getRectRepulsion = (
//   point: Point,
//   obstacle: SimpleRouteJson["obstacles"][number],
//   requiredDistance: number,
// ) => {
//   const halfWidth = obstacle.width / 2
//   const halfHeight = obstacle.height / 2
//   const closestX = clampValue(
//     point.x,
//     obstacle.center.x - halfWidth,
//     obstacle.center.x + halfWidth,
//   )
//   const closestY = clampValue(
//     point.y,
//     obstacle.center.y - halfHeight,
//     obstacle.center.y + halfHeight,
//   )
//   let separationX = point.x - closestX
//   let separationY = point.y - closestY
//   let distance = Math.hypot(separationX, separationY)

//   if (distance <= POSITION_EPSILON) {
//     const dxToSide = halfWidth - Math.abs(point.x - obstacle.center.x)
//     const dyToSide = halfHeight - Math.abs(point.y - obstacle.center.y)
//     if (dxToSide < dyToSide) {
//       separationX = point.x >= obstacle.center.x ? 1 : -1
//       separationY = 0
//       distance = 0
//     } else {
//       separationX = 0
//       separationY = point.y >= obstacle.center.y ? 1 : -1
//       distance = 0
//     }
//   }

//   const penetration = requiredDistance - distance
//   if (penetration <= 0) return undefined

//   const directionLength = Math.hypot(separationX, separationY)
//   return {
//     direction: {
//       x: directionLength > POSITION_EPSILON ? separationX / directionLength : 1,
//       y: directionLength > POSITION_EPSILON ? separationY / directionLength : 0,
//     },
//     penetration,
//   }
// }

// const getRepulsionPointForError = (
//   srj: SimpleRouteJson,
//   error: Record<string, unknown>,
//   center: Point,
// ) => {
//   const message = error.message
//   if (typeof message !== "string" || !message.includes("pcb_")) {
//     return center
//   }

//   return getNearestObstacleNearPoint(srj, center)?.center ?? center
// }

// const getCoincidentPointIndexes = (route: MutableRoute, pointIndex: number) => {
//   const point = route.route[pointIndex]
//   if (!point) return []
//   const pointIndexes = [pointIndex]

//   for (let cursor = pointIndex - 1; cursor >= 0; cursor -= 1) {
//     const candidate = route.route[cursor]
//     if (!candidate || !areSameXY(candidate, point)) break
//     pointIndexes.push(cursor)
//   }
//   for (let cursor = pointIndex + 1; cursor < route.route.length; cursor += 1) {
//     const candidate = route.route[cursor]
//     if (!candidate || !areSameXY(candidate, point)) break
//     pointIndexes.push(cursor)
//   }

//   return [...new Set(pointIndexes)]
// }

// const moveRoutePoint = (
//   routes: MutableRoute[],
//   routeIndex: number,
//   pointIndex: number,
//   dx: number,
//   dy: number,
//   bounds: SimpleRouteJson["bounds"],
// ) => {
//   const route = routes[routeIndex]
//   if (!route || pointIndex <= 0 || pointIndex >= route.route.length - 1) {
//     return false
//   }

//   const pointIndexes = getCoincidentPointIndexes(route, pointIndex)
//   if (
//     pointIndexes.includes(0) ||
//     pointIndexes.includes(route.route.length - 1)
//   ) {
//     return false
//   }

//   let changed = false
//   for (const candidateIndex of pointIndexes) {
//     const point = route.route[candidateIndex]
//     if (!point) continue
//     point.x += dx
//     point.y += dy
//     clampToBounds(point, bounds)
//     changed = true
//   }

//   return changed
// }

// const getDirectionAwayFromPoint = (segment: Segment, point: Point) => {
//   const projection = pointToSegmentProjection(point, segment)
//   const separationX = projection.x - point.x
//   const separationY = projection.y - point.y
//   const distance = Math.hypot(separationX, separationY)
//   const segmentX = segment.end.x - segment.start.x
//   const segmentY = segment.end.y - segment.start.y
//   const segmentLength = Math.hypot(segmentX, segmentY)
//   const fallbackSign = segment.routeIndex % 2 === 0 ? 1 : -1

//   return {
//     projection,
//     direction:
//       distance > POSITION_EPSILON
//         ? {
//             x: separationX / distance,
//             y: separationY / distance,
//           }
//         : segmentLength > POSITION_EPSILON
//           ? {
//               x: (-segmentY / segmentLength) * fallbackSign,
//               y: (segmentX / segmentLength) * fallbackSign,
//             }
//           : { x: 1, y: 0 },
//   }
// }

// const insertDetourPointAwayFromPoint = (
//   routes: MutableRoute[],
//   segment: Segment,
//   point: Point,
//   bounds: SimpleRouteJson["bounds"],
//   scale: number,
// ) => {
//   const route = routes[segment.routeIndex]
//   if (!route) return false

//   const { projection, direction } = getDirectionAwayFromPoint(segment, point)
//   const detourPoint = {
//     ...route.route[segment.startIndex]!,
//     x: projection.x + direction.x * MAX_ERROR_MOVE * scale,
//     y: projection.y + direction.y * MAX_ERROR_MOVE * scale,
//   }
//   clampToBounds(detourPoint, bounds)
//   route.route.splice(segment.endIndex, 0, detourPoint)
//   return true
// }

// const moveVia = (
//   routes: MutableRoute[],
//   via: ViaNode,
//   dx: number,
//   dy: number,
//   bounds: SimpleRouteJson["bounds"],
// ) => {
//   if (!via.movable) return false
//   const route = routes[via.routeIndex]
//   if (!route) return false

//   via.x += dx
//   via.y += dy
//   clampToBounds(via, bounds)
//   for (const pointIndex of via.pointIndexes) {
//     const point = route.route[pointIndex]
//     if (!point) continue
//     point.x = via.x
//     point.y = via.y
//   }
//   return true
// }

// const moveSegmentAwayFromPoint = (
//   routes: MutableRoute[],
//   segment: Segment,
//   point: Point,
//   bounds: SimpleRouteJson["bounds"],
//   scale = 1,
// ) => {
//   const { projection, direction } = getDirectionAwayFromPoint(segment, point)
//   const move = MAX_ERROR_MOVE * scale
//   const startWeight = 1 - projection.t
//   const endWeight = projection.t

//   const movedStart = moveRoutePoint(
//     routes,
//     segment.routeIndex,
//     segment.startIndex,
//     direction.x * move * startWeight,
//     direction.y * move * startWeight,
//     bounds,
//   )
//   const movedEnd = moveRoutePoint(
//     routes,
//     segment.routeIndex,
//     segment.endIndex,
//     direction.x * move * endWeight,
//     direction.y * move * endWeight,
//     bounds,
//   )

//   if (movedStart || movedEnd) {
//     return true
//   }

//   return insertDetourPointAwayFromPoint(routes, segment, point, bounds, scale)
// }

// const moveSegmentAwayFromObstacle = (
//   routes: MutableRoute[],
//   segment: Segment,
//   obstacle: SimpleRouteJson["obstacles"][number],
//   bounds: SimpleRouteJson["bounds"],
//   scale = 1,
// ) => {
//   const repulsion = getSegmentRectRepulsion(
//     segment,
//     obstacle,
//     segment.radius + PREFERRED_TRACE_TO_PAD_CLEARANCE + CLEARANCE_SLACK,
//   )
//   if (!repulsion) return false

//   const move = Math.min(
//     TRACE_PAD_REPAIR_MAX_MOVE * Math.abs(scale),
//     repulsion.penetration,
//   )
//   const movedSegment = moveSegmentByDistribution(
//     routes,
//     segment,
//     repulsion.direction.x * move,
//     repulsion.direction.y * move,
//     bounds,
//     repulsion.t,
//   )
//   if (movedSegment) return true

//   const route = routes[segment.routeIndex]
//   if (!route) return false
//   const requiredDistance =
//     segment.radius + PREFERRED_TRACE_TO_PAD_CLEARANCE + CLEARANCE_SLACK
//   const halfWidth = obstacle.width / 2
//   const halfHeight = obstacle.height / 2
//   const detourPoints =
//     Math.abs(repulsion.direction.y) >= Math.abs(repulsion.direction.x)
//       ? [
//           {
//             ...route.route[segment.startIndex]!,
//             x: obstacle.center.x - halfWidth - requiredDistance,
//             y:
//               obstacle.center.y +
//               repulsion.direction.y * (halfHeight + requiredDistance),
//           },
//           {
//             ...route.route[segment.startIndex]!,
//             x: obstacle.center.x + halfWidth + requiredDistance,
//             y:
//               obstacle.center.y +
//               repulsion.direction.y * (halfHeight + requiredDistance),
//           },
//         ]
//       : [
//           {
//             ...route.route[segment.startIndex]!,
//             x:
//               obstacle.center.x +
//               repulsion.direction.x * (halfWidth + requiredDistance),
//             y: obstacle.center.y - halfHeight - requiredDistance,
//           },
//           {
//             ...route.route[segment.startIndex]!,
//             x:
//               obstacle.center.x +
//               repulsion.direction.x * (halfWidth + requiredDistance),
//             y: obstacle.center.y + halfHeight + requiredDistance,
//           },
//         ]

//   const orderedDetourPoints = detourPoints
//     .map((point) => ({
//       point,
//       t: pointToSegmentProjection(point, segment).t,
//     }))
//     .sort((a, b) => a.t - b.t)
//     .map(({ point }) => {
//       clampToBounds(point, bounds)
//       return point
//     })

//   route.route.splice(segment.endIndex, 0, ...orderedDetourPoints)
//   return true
// }

// const getNearestSegment = (
//   segments: Segment[],
//   point: Point,
//   routeIndex?: number,
// ) => {
//   let best:
//     | {
//         segment: Segment
//         distance: number
//       }
//     | undefined

//   for (const segment of segments) {
//     if (routeIndex !== undefined && segment.routeIndex !== routeIndex) continue
//     const projection = pointToSegmentProjection(point, segment)
//     const distance = Math.hypot(projection.x - point.x, projection.y - point.y)
//     if (!best || distance < best.distance) {
//       best = { segment, distance }
//     }
//   }

//   return best?.segment
// }

// const getNearestVia = (vias: ViaNode[], point: Point) => {
//   let best:
//     | {
//         via: ViaNode
//         distance: number
//       }
//     | undefined

//   for (const via of vias) {
//     const distance = Math.hypot(via.x - point.x, via.y - point.y)
//     if (!best || distance < best.distance) {
//       best = { via, distance }
//     }
//   }

//   return best?.via
// }

// const getNearestViaPair = (vias: ViaNode[], point: Point) => {
//   const nearest = vias
//     .map((via) => ({
//       via,
//       distance: Math.hypot(via.x - point.x, via.y - point.y),
//     }))
//     .sort((a, b) => a.distance - b.distance)
//     .slice(0, 2)
//     .map(({ via }) => via)

//   return nearest.length === 2 ? (nearest as [ViaNode, ViaNode]) : undefined
// }

// const moveViaAwayFromPoint = (
//   routes: MutableRoute[],
//   via: ViaNode,
//   point: Point,
//   bounds: SimpleRouteJson["bounds"],
// ) => {
//   const separationX = via.x - point.x
//   const separationY = via.y - point.y
//   const distance = Math.hypot(separationX, separationY)
//   const directionX = distance > POSITION_EPSILON ? separationX / distance : 1
//   const directionY = distance > POSITION_EPSILON ? separationY / distance : 0

//   return moveVia(
//     routes,
//     via,
//     directionX * MAX_ERROR_MOVE,
//     directionY * MAX_ERROR_MOVE,
//     bounds,
//   )
// }

// const getSegmentDistanceCandidates = (left: Segment, right: Segment) => {
//   const leftStartProjection = pointToSegmentProjection(left.start, right)
//   const leftEndProjection = pointToSegmentProjection(left.end, right)
//   const rightStartProjection = pointToSegmentProjection(right.start, left)
//   const rightEndProjection = pointToSegmentProjection(right.end, left)

//   return [
//     {
//       leftT: 0,
//       rightT: leftStartProjection.t,
//       leftPoint: left.start,
//       rightPoint: leftStartProjection,
//     },
//     {
//       leftT: 1,
//       rightT: leftEndProjection.t,
//       leftPoint: left.end,
//       rightPoint: leftEndProjection,
//     },
//     {
//       leftT: rightStartProjection.t,
//       rightT: 0,
//       leftPoint: rightStartProjection,
//       rightPoint: right.start,
//     },
//     {
//       leftT: rightEndProjection.t,
//       rightT: 1,
//       leftPoint: rightEndProjection,
//       rightPoint: right.end,
//     },
//   ].sort((a, b) => {
//     const aDistance = Math.hypot(
//       a.leftPoint.x - a.rightPoint.x,
//       a.leftPoint.y - a.rightPoint.y,
//     )
//     const bDistance = Math.hypot(
//       b.leftPoint.x - b.rightPoint.x,
//       b.leftPoint.y - b.rightPoint.y,
//     )
//     return aDistance - bDistance
//   })
// }

// const moveSegmentByDistribution = (
//   routes: MutableRoute[],
//   segment: Segment,
//   dx: number,
//   dy: number,
//   bounds: SimpleRouteJson["bounds"],
//   t: number,
// ) => {
//   const clampedT = clampValue(t, 0, 1)
//   const startWeight = 1 - clampedT
//   const endWeight = clampedT
//   const movedStart = moveRoutePoint(
//     routes,
//     segment.routeIndex,
//     segment.startIndex,
//     dx * startWeight,
//     dy * startWeight,
//     bounds,
//   )
//   const movedEnd = moveRoutePoint(
//     routes,
//     segment.routeIndex,
//     segment.endIndex,
//     dx * endWeight,
//     dy * endWeight,
//     bounds,
//   )

//   return movedStart || movedEnd
// }

// const pushViaViaPair = (
//   routes: MutableRoute[],
//   left: ViaNode,
//   right: ViaNode,
//   bounds: SimpleRouteJson["bounds"],
//   maxMove = BROAD_MAX_MOVE,
// ) => {
//   const requiredDistance =
//     left.radius +
//     right.radius +
//     PREFERRED_VIA_TO_VIA_CLEARANCE +
//     CLEARANCE_SLACK
//   const separationX = left.x - right.x
//   const separationY = left.y - right.y
//   const distance = Math.hypot(separationX, separationY)
//   const penetration = requiredDistance - distance
//   if (penetration <= 0) return false

//   const fallbackAngle = (left.routeIndex * 97 + right.routeIndex * 13) * 1.618
//   const directionX =
//     distance > POSITION_EPSILON
//       ? separationX / distance
//       : Math.cos(fallbackAngle)
//   const directionY =
//     distance > POSITION_EPSILON
//       ? separationY / distance
//       : Math.sin(fallbackAngle)
//   const movableCount = Number(left.movable) + Number(right.movable)
//   if (movableCount === 0) return false

//   const move = Math.min(maxMove, penetration / movableCount)
//   const movedLeft = moveVia(
//     routes,
//     left,
//     directionX * move,
//     directionY * move,
//     bounds,
//   )
//   const movedRight = moveVia(
//     routes,
//     right,
//     -directionX * move,
//     -directionY * move,
//     bounds,
//   )
//   return movedLeft || movedRight
// }

// const pushViaSegmentPair = (
//   routes: MutableRoute[],
//   via: ViaNode,
//   segment: Segment,
//   bounds: SimpleRouteJson["bounds"],
// ) => {
//   if (via.rootConnectionName === segment.rootConnectionName) return false

//   const projection = pointToSegmentProjection(via, segment)
//   const separationX = via.x - projection.x
//   const separationY = via.y - projection.y
//   const distance = Math.hypot(separationX, separationY)
//   const requiredDistance =
//     via.radius +
//     segment.radius +
//     (RELAXED_DRC_OPTIONS.traceClearance ?? 0.1) +
//     CLEARANCE_SLACK
//   const penetration = requiredDistance - distance
//   if (penetration <= 0) return false

//   const segmentX = segment.end.x - segment.start.x
//   const segmentY = segment.end.y - segment.start.y
//   const segmentLength = Math.hypot(segmentX, segmentY)
//   const fallbackSign = via.routeIndex % 2 === 0 ? 1 : -1
//   const directionX =
//     distance > POSITION_EPSILON
//       ? separationX / distance
//       : segmentLength > POSITION_EPSILON
//         ? (-segmentY / segmentLength) * fallbackSign
//         : 1
//   const directionY =
//     distance > POSITION_EPSILON
//       ? separationY / distance
//       : segmentLength > POSITION_EPSILON
//         ? (segmentX / segmentLength) * fallbackSign
//         : 0
//   const move = Math.min(BROAD_MAX_MOVE, penetration / 2)
//   const movedVia = moveVia(
//     routes,
//     via,
//     directionX * move,
//     directionY * move,
//     bounds,
//   )
//   const movedSegment = moveSegmentByDistribution(
//     routes,
//     segment,
//     -directionX * move,
//     -directionY * move,
//     bounds,
//     projection.t,
//   )
//   return movedVia || movedSegment
// }

// const pushSegmentSegmentPair = (
//   routes: MutableRoute[],
//   left: Segment,
//   right: Segment,
//   bounds: SimpleRouteJson["bounds"],
// ) => {
//   if (
//     left.z !== right.z ||
//     left.rootConnectionName === right.rootConnectionName
//   ) {
//     return false
//   }

//   const [candidate] = getSegmentDistanceCandidates(left, right)
//   if (!candidate) return false

//   const separationX = candidate.leftPoint.x - candidate.rightPoint.x
//   const separationY = candidate.leftPoint.y - candidate.rightPoint.y
//   const distance = Math.hypot(separationX, separationY)
//   const requiredDistance =
//     left.radius +
//     right.radius +
//     (RELAXED_DRC_OPTIONS.traceClearance ?? 0.1) +
//     CLEARANCE_SLACK
//   const penetration = requiredDistance - distance
//   if (penetration <= 0) return false

//   const leftVectorX = left.end.x - left.start.x
//   const leftVectorY = left.end.y - left.start.y
//   const fallbackLength = Math.hypot(leftVectorX, leftVectorY)
//   const fallbackSign = (left.routeIndex + right.routeIndex) % 2 === 0 ? 1 : -1
//   const directionX =
//     distance > POSITION_EPSILON
//       ? separationX / distance
//       : fallbackLength > POSITION_EPSILON
//         ? (-leftVectorY / fallbackLength) * fallbackSign
//         : 1
//   const directionY =
//     distance > POSITION_EPSILON
//       ? separationY / distance
//       : fallbackLength > POSITION_EPSILON
//         ? (leftVectorX / fallbackLength) * fallbackSign
//         : 0
//   const move = Math.min(BROAD_MAX_MOVE, penetration / 2)
//   const movedLeft = moveSegmentByDistribution(
//     routes,
//     left,
//     directionX * move,
//     directionY * move,
//     bounds,
//     candidate.leftT,
//   )
//   const movedRight = moveSegmentByDistribution(
//     routes,
//     right,
//     -directionX * move,
//     -directionY * move,
//     bounds,
//     candidate.rightT,
//   )
//   return movedLeft || movedRight
// }

// const obstacleAppliesToSegment = (
//   obstacle: SimpleRouteJson["obstacles"][number],
//   segment: Segment,
// ) => {
//   if (obstacle.zLayers?.includes(segment.z)) return true
//   if (segment.z === 0 && obstacle.layers.includes("top")) return true
//   if (segment.z === 1 && obstacle.layers.includes("bottom")) return true
//   return obstacle.layers.length === 0
// }

// const getSegmentRectRepulsion = (
//   segment: Segment,
//   obstacle: SimpleRouteJson["obstacles"][number],
//   requiredDistance: number,
// ) => {
//   const halfWidth = obstacle.width / 2
//   const halfHeight = obstacle.height / 2
//   const obstacleCorners = [
//     {
//       x: obstacle.center.x - halfWidth,
//       y: obstacle.center.y - halfHeight,
//     },
//     {
//       x: obstacle.center.x + halfWidth,
//       y: obstacle.center.y - halfHeight,
//     },
//     {
//       x: obstacle.center.x + halfWidth,
//       y: obstacle.center.y + halfHeight,
//     },
//     {
//       x: obstacle.center.x - halfWidth,
//       y: obstacle.center.y + halfHeight,
//     },
//   ]
//   const projectedCandidates = [obstacle.center, ...obstacleCorners].map(
//     (point) => pointToSegmentProjection(point, segment),
//   )
//   const candidates = [
//     { point: segment.start, t: 0 },
//     { point: segment.end, t: 1 },
//     {
//       point: {
//         x: (segment.start.x + segment.end.x) / 2,
//         y: (segment.start.y + segment.end.y) / 2,
//       },
//       t: 0.5,
//     },
//     ...projectedCandidates.map((projection) => ({
//       point: { x: projection.x, y: projection.y },
//       t: projection.t,
//     })),
//   ]

//   let best:
//     | {
//         direction: Point
//         penetration: number
//         t: number
//       }
//     | undefined

//   for (const candidate of candidates) {
//     const repulsion = getRectRepulsion(
//       candidate.point,
//       obstacle,
//       requiredDistance,
//     )
//     if (!repulsion) continue
//     if (!best || repulsion.penetration > best.penetration) {
//       best = {
//         ...repulsion,
//         t: candidate.t,
//       }
//     }
//   }

//   return best
// }

// const pushMovablesAwayFromObstacles = (
//   srj: SimpleRouteJson,
//   routes: MutableRoute[],
//   vias: ViaNode[],
//   segments: Segment[],
// ) => {
//   let changed = false
//   const requiredTraceObstacleDistance =
//     srj.minTraceWidth / 2 + PREFERRED_TRACE_TO_PAD_CLEARANCE + CLEARANCE_SLACK
//   const requiredViaObstacleDistance =
//     (srj.minViaDiameter ?? 0.3) / 2 +
//     (srj.defaultObstacleMargin ?? 0.1) +
//     CLEARANCE_SLACK

//   for (const obstacle of srj.obstacles) {
//     if (obstacle.isCopperPour) continue

//     for (const via of vias) {
//       if (obstacleSharesNet(via.rootConnectionName, obstacle)) continue
//       const repulsion = getRectRepulsion(
//         via,
//         obstacle,
//         requiredViaObstacleDistance,
//       )
//       if (!repulsion) continue
//       const move = Math.min(BROAD_MAX_MOVE, repulsion.penetration)
//       changed =
//         moveVia(
//           routes,
//           via,
//           repulsion.direction.x * move,
//           repulsion.direction.y * move,
//           srj.bounds,
//         ) || changed
//     }

//     for (const segment of segments) {
//       if (
//         obstacleSharesNet(segment.rootConnectionName, obstacle) ||
//         !obstacleAppliesToSegment(obstacle, segment)
//       ) {
//         continue
//       }
//       const repulsion = getSegmentRectRepulsion(
//         segment,
//         obstacle,
//         requiredTraceObstacleDistance,
//       )
//       if (!repulsion) continue
//       const move = Math.min(BROAD_MAX_MOVE, repulsion.penetration)
//       changed =
//         moveSegmentByDistribution(
//           routes,
//           segment,
//           repulsion.direction.x * move,
//           repulsion.direction.y * move,
//           srj.bounds,
//           repulsion.t,
//         ) || changed
//     }
//   }

//   return changed
// }

// const applyBroadRepulsionPass = (
//   srj: SimpleRouteJson,
//   routes: MutableRoute[],
// ) => {
//   let changed = false
//   const vias = collectViaNodes(routes)
//   const segments = collectSegments(routes)

//   for (let leftIndex = 0; leftIndex < vias.length; leftIndex += 1) {
//     const left = vias[leftIndex]
//     if (!left) continue
//     for (
//       let rightIndex = leftIndex + 1;
//       rightIndex < vias.length;
//       rightIndex += 1
//     ) {
//       const right = vias[rightIndex]
//       if (!right) continue
//       changed = pushViaViaPair(routes, left, right, srj.bounds) || changed
//     }
//   }

//   for (const via of vias) {
//     for (const segment of segments) {
//       changed = pushViaSegmentPair(routes, via, segment, srj.bounds) || changed
//     }
//   }

//   for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
//     const left = segments[leftIndex]
//     if (!left) continue
//     for (
//       let rightIndex = leftIndex + 1;
//       rightIndex < segments.length;
//       rightIndex += 1
//     ) {
//       const right = segments[rightIndex]
//       if (!right) continue
//       changed =
//         pushSegmentSegmentPair(routes, left, right, srj.bounds) || changed
//     }
//   }

//   return pushMovablesAwayFromObstacles(srj, routes, vias, segments) || changed
// }

// const applyBroadRepulsionForces = (
//   srj: SimpleRouteJson,
//   routes: HighDensityRoute[],
//   effort: number,
// ) => {
//   const mutableRoutes = cloneRoutes(routes)
//   const maxPasses = Math.max(
//     2,
//     Math.round(BROAD_FORCE_PASSES * Math.max(1, effort)),
//   )

//   for (let pass = 0; pass < maxPasses; pass += 1) {
//     if (!applyBroadRepulsionPass(srj, mutableRoutes)) break
//   }

//   return materializeRoutes(mutableRoutes)
// }

// const deriveVias = (route: MutableRoute): MutableRoute["vias"] => {
//   const vias: MutableRoute["vias"] = []
//   for (let index = 0; index < route.route.length - 1; index += 1) {
//     const current = route.route[index]
//     const next = route.route[index + 1]
//     if (!current || !next) continue
//     if (current.z === next.z || !areSameXY(current, next)) continue

//     const via = {
//       x: Number(current.x.toFixed(3)),
//       y: Number(current.y.toFixed(3)),
//     }
//     const previousVia = vias.at(-1)
//     if (previousVia && areSameXY(previousVia, via)) continue
//     vias.push(via)
//   }
//   return vias
// }

// const materializeRoutes = (routes: MutableRoute[]): HighDensityRoute[] =>
//   routes.map((route) => ({
//     ...route,
//     vias: deriveVias(route),
//   }))

// const parseTraceRouteIndex = (error: Record<string, unknown>) => {
//   const traceId = error.pcb_trace_id
//   if (typeof traceId !== "string") return undefined
//   const match = traceId.match(/^trace_(\d+)/)
//   return match ? Number.parseInt(match[1]!, 10) : undefined
// }

// const getErrorCenter = (error: Record<string, unknown>): Point | undefined => {
//   const center = error.center ?? error.pcb_center
//   if (!center || typeof center !== "object") return undefined
//   const maybeCenter = center as Record<string, unknown>
//   return typeof maybeCenter.x === "number" && typeof maybeCenter.y === "number"
//     ? { x: maybeCenter.x, y: maybeCenter.y }
//     : undefined
// }

// const getCenteredErrors = (errors: Array<Record<string, unknown>>) =>
//   errors.filter((error) => Boolean(getErrorCenter(error)))

// const isViaDrcError = (error: Record<string, unknown>) =>
//   Array.isArray(error.pcb_via_ids) ||
//   (typeof error.pcb_error_id === "string" &&
//     (error.pcb_error_id.startsWith("same_net_vias_close_") ||
//       error.pcb_error_id.startsWith("different_net_vias_close_")))

// const getViaDrcIssueCount = (snapshot: DrcSnapshot) =>
//   snapshot.errors.filter(isViaDrcError).length

// const getForceScalesForEffort = (effort: number) =>
//   effort >= 2 ? DEEP_ERROR_FORCE_SCALES : FAST_ERROR_FORCE_SCALES

// const getMaxPassesForEffort = (effort: number) =>
//   Math.max(2, Math.round(BASE_MAX_PASSES * Math.max(1, effort)))

// const getMaxCandidateAttemptsForEffort = (effort: number) =>
//   Math.max(4, Math.round(BASE_MAX_CANDIDATE_ATTEMPTS * Math.max(1, effort)))

// const getMaxTargetedCandidateAttemptsForEffort = (effort: number) =>
//   Math.max(
//     1,
//     Math.round(BASE_MAX_TARGETED_CANDIDATE_ATTEMPTS * Math.max(1, effort)),
//   )

// const applyDrcErrorForces = (
//   srj: SimpleRouteJson,
//   routes: MutableRoute[],
//   errors: Array<Record<string, unknown>>,
//   traceRouteIndexById: Map<string, number>,
//   scale: number,
// ) => {
//   let changed = false
//   const vias = collectViaNodes(routes)
//   const segments = collectSegments(routes)

//   for (const error of errors) {
//     const center = getErrorCenter(error)
//     if (!center) continue
//     const repulsionPoint = getRepulsionPointForError(srj, error, center)

//     const viaIds = error.pcb_via_ids
//     if (Array.isArray(viaIds) && viaIds.length > 0) {
//       const nearestViaPair = getNearestViaPair(vias, center)
//       if (nearestViaPair) {
//         changed =
//           pushViaViaPair(
//             routes,
//             nearestViaPair[0],
//             nearestViaPair[1],
//             srj.bounds,
//             VIA_PAIR_REPAIR_MAX_MOVE * Math.abs(scale),
//           ) || changed
//       } else {
//         const nearestVia = getNearestVia(vias, center)
//         if (nearestVia) {
//           changed =
//             moveViaAwayFromPoint(
//               routes,
//               nearestVia,
//               repulsionPoint,
//               srj.bounds,
//             ) || changed
//         }
//       }
//       continue
//     }

//     const traceId = error.pcb_trace_id
//     const routeIndex =
//       typeof traceId === "string"
//         ? (traceRouteIndexById.get(traceId) ?? parseTraceRouteIndex(error))
//         : parseTraceRouteIndex(error)
//     const nearestSegment = getNearestSegment(segments, center, routeIndex)
//     if (nearestSegment) {
//       const nearestObstacle = getNearestObstacleNearPoint(srj, center)
//       const movedSegment =
//         nearestObstacle &&
//         !obstacleSharesNet(
//           nearestSegment.rootConnectionName,
//           nearestObstacle,
//         ) &&
//         obstacleAppliesToSegment(nearestObstacle, nearestSegment)
//           ? moveSegmentAwayFromObstacle(
//               routes,
//               nearestSegment,
//               nearestObstacle,
//               srj.bounds,
//               scale,
//             )
//           : moveSegmentAwayFromPoint(
//               routes,
//               nearestSegment,
//               repulsionPoint,
//               srj.bounds,
//               scale,
//             )
//       changed = movedSegment || changed
//     }

//     const nearestVia = getNearestVia(vias, center)
//     if (
//       nearestVia &&
//       Math.hypot(nearestVia.x - center.x, nearestVia.y - center.y) < 0.35
//     ) {
//       changed =
//         moveViaAwayFromPoint(routes, nearestVia, repulsionPoint, srj.bounds) ||
//         changed
//     }
//   }

//   return changed
// }

// export class GlobalDrcForceImproveSolver extends BaseSolver {
//   readonly srj: SimpleRouteJson
//   readonly inputHdRoutes: HighDensityRoute[]
//   readonly effort: number
//   outputHdRoutes: HighDensityRoute[]

//   constructor(params: GlobalDrcForceImproveSolverParams) {
//     super()
//     this.srj = params.srj
//     this.inputHdRoutes = params.hdRoutes
//     this.effort = params.effort ?? 1
//     this.outputHdRoutes = params.hdRoutes
//     this.MAX_ITERATIONS = 1
//   }

//   override getConstructorParams() {
//     return [
//       { srj: this.srj, hdRoutes: this.inputHdRoutes, effort: this.effort },
//     ] as const
//   }

//   override _step() {
//     let bestRoutes = this.inputHdRoutes
//     let bestSnapshot = getDrcSnapshot(this.srj, bestRoutes)
//     let bestIssueCount = bestSnapshot.count
//     let bestIssueScore = bestSnapshot.issueScore
//     let bestViaIssueCount = getViaDrcIssueCount(bestSnapshot)
//     const initialDrcIssueCount = bestIssueCount
//     let broadForceAccepted = false
//     let targetedForceAccepted = false
//     let candidateAttempts = 0

//     if (bestIssueCount > 0) {
//       const broadCandidateRoutes = applyBroadRepulsionForces(
//         this.srj,
//         bestRoutes,
//         this.effort,
//       )
//       const broadCandidateSnapshot = getDrcSnapshot(
//         this.srj,
//         broadCandidateRoutes,
//       )

//       const broadCandidateViaIssueCount = getViaDrcIssueCount(
//         broadCandidateSnapshot,
//       )
//       if (
//         broadCandidateSnapshot.count < bestIssueCount ||
//         (broadCandidateSnapshot.count === bestIssueCount &&
//           broadCandidateSnapshot.issueScore < bestIssueScore) ||
//         (broadCandidateSnapshot.count === bestIssueCount &&
//           broadCandidateViaIssueCount < bestViaIssueCount)
//       ) {
//         bestRoutes = broadCandidateRoutes
//         bestSnapshot = broadCandidateSnapshot
//         bestIssueCount = broadCandidateSnapshot.count
//         bestIssueScore = broadCandidateSnapshot.issueScore
//         bestViaIssueCount = broadCandidateViaIssueCount
//         broadForceAccepted = true
//       }
//     }

//     const maxPasses = getMaxPassesForEffort(this.effort)
//     const maxCandidateAttempts = getMaxCandidateAttemptsForEffort(this.effort)
//     for (
//       let pass = 0;
//       pass < maxPasses &&
//       bestIssueCount > 0 &&
//       candidateAttempts < maxCandidateAttempts;
//       pass += 1
//     ) {
//       const centeredErrors = getCenteredErrors(bestSnapshot.errors)
//       if (centeredErrors.length === 0) break

//       let acceptedCandidate = false
//       for (const scale of getForceScalesForEffort(this.effort)) {
//         if (candidateAttempts >= maxCandidateAttempts) break

//         const candidateRoutes = cloneRoutes(bestRoutes)
//         const changed = applyDrcErrorForces(
//           this.srj,
//           candidateRoutes,
//           centeredErrors,
//           bestSnapshot.traceRouteIndexById,
//           scale,
//         )
//         if (!changed) continue

//         candidateAttempts += 1
//         const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
//         const candidateSnapshot = getDrcSnapshot(
//           this.srj,
//           materializedCandidateRoutes,
//         )
//         const candidateViaIssueCount = getViaDrcIssueCount(candidateSnapshot)

//         if (
//           candidateSnapshot.count < bestIssueCount ||
//           (candidateSnapshot.count === bestIssueCount &&
//             candidateSnapshot.issueScore < bestIssueScore) ||
//           (candidateSnapshot.count === bestIssueCount &&
//             candidateViaIssueCount < bestViaIssueCount)
//         ) {
//           bestRoutes = materializedCandidateRoutes
//           bestSnapshot = candidateSnapshot
//           bestIssueCount = candidateSnapshot.count
//           bestIssueScore = candidateSnapshot.issueScore
//           bestViaIssueCount = candidateViaIssueCount
//           targetedForceAccepted = true
//           acceptedCandidate = true
//           break
//         }
//       }

//       if (!acceptedCandidate) break
//     }

//     this.outputHdRoutes = bestRoutes
//     this.stats = {
//       initialDrcIssueCount,
//       finalDrcIssueCount: bestIssueCount,
//       globalDrcForceImproveBroadForceAccepted: broadForceAccepted,
//       globalDrcForceImproveTargetedForceAccepted: targetedForceAccepted,
//       globalDrcForceImproveCandidateAttempts: candidateAttempts,
//     }
//     this.solved = true
//   }

//   getOutput() {
//     return this.outputHdRoutes
//   }
// }
