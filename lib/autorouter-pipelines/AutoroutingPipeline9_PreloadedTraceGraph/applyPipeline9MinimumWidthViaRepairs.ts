import {
  getNewViaPadViolations,
  getRepairViaGeometry,
} from "@tscircuit/repair04"
import type { PcbVia } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { getMinimumTraceWidthByConnectionName } from "lib/utils/getMinimumTraceWidthByConnectionName"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline9AutoroutingDrcEvaluator } from "./createPipeline9AutoroutingDrcEvaluator"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"
import { isViaPadClearanceError } from "./isViaPadClearanceError"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { getPipeline9RouteIndexByTraceId } from "./pipeline9JointDrcRepairUtils"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"

type Params = {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  connections: SimpleRouteConnection[]
  routes: HighDensityRoute[]
  otherHdRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  viaHoleDiameter: number
}

const MAX_CANDIDATE_EVALUATIONS = 128
const DISPLACEMENTS = [0.025, 0.05, 0.1, 0.2]

export const applyPipeline9MinimumWidthViaRepairs = ({
  inputSrj,
  srjWithPointPairs,
  connections,
  routes,
  otherHdRoutes,
  connMap,
  viaHoleDiameter,
}: Params): HighDensityRoute[] => {
  const minimumWidths = getMinimumTraceWidthByConnectionName(connections)
  if (minimumWidths.size === 0) return routes
  routes = canonicalizePipeline9HdRoutes(routes)
  const convert = (candidate: HighDensityRoute[]): SimplifiedPcbTraces =>
    convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections,
      originalConnections: inputSrj.connections,
      hdRoutes: candidate,
      layerCount: inputSrj.layerCount,
      obstacles: inputSrj.obstacles,
      defaultViaHoleDiameter: viaHoleDiameter,
      connMap,
    })
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj,
    srjWithPointPairs,
    includeBoardClearance: true,
  })
  const initialResult = evaluate(convert(routes))
  const errors = initialResult.errors
  if (errors.length === 0) return routes
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes,
    newConnections: connections,
    syntheticConnectionNames: new Set(),
  })
  const allRoutes = [...routes, ...otherHdRoutes]
  const nets = getPipeline9NetByConnectionName(allRoutes, connMap)
  let candidateCount = 0
  for (const error of errors) {
    if (!isViaPadClearanceError(error)) continue
    const routeIndex = routeIndexByTraceId.get(error.pcb_trace_id)
    if (routeIndex === undefined) continue
    const route = routes[routeIndex]!
    if (!minimumWidths.has(route.connectionName)) continue
    const net = nets.get(route.connectionName)
    if (net === undefined) {
      throw new Error(
        `Minimum-width via repair has no net for "${route.connectionName}"`,
      )
    }
    const physicalVia = initialResult.circuitJson.find(
      (element): element is PcbVia =>
        element.type === "pcb_via" &&
        element.pcb_via_id === error.pcb_via_ids[0],
    )
    if (!physicalVia) {
      throw new Error(
        `Minimum-width via repair lost via "${error.pcb_via_ids[0]}"`,
      )
    }
    const via = getRepairViaGeometry(route, inputSrj.layerCount).find(
      (candidate) =>
        Math.hypot(candidate.x - physicalVia.x, candidate.y - physicalVia.y) <
        1e-6,
    )
    if (!via) {
      throw new Error(
        `Minimum-width via repair lost the transition on "${route.connectionName}"`,
      )
    }
    const minZ = inputSrj.allowBlindAndBuriedVias ? via.minZ : 0
    const maxZ = inputSrj.allowBlindAndBuriedVias
      ? via.maxZ
      : inputSrj.layerCount - 1
    const pointIndices = new Set(via.pointIndices)
    if (
      via.pointIndices.some(
        (index) =>
          index === 0 ||
          index === route.route.length - 1 ||
          route.route[index]!.pcb_port_id ||
          route.route[index]!.terminalApproach,
      )
    )
      continue
    const hasJunction = allRoutes.some((other) => {
      if (other === route || nets.get(other.connectionName) !== net)
        return false
      const geometry = getPipeline9RouteCopperGeometry(other, inputSrj)
      return (
        geometry.wireSegments.some(
          (segment) =>
            segment.z >= minZ &&
            segment.z <= maxZ &&
            minimumDistanceBetweenSegments(
              via,
              via,
              segment.start,
              segment.end,
            ) <=
              (via.diameter + segment.width) / 2 + 1e-6,
        ) ||
        geometry.viaSpans.some(
          (span) =>
            span.minZ <= maxZ &&
            span.maxZ >= minZ &&
            Math.hypot(span.center.x - via.x, span.center.y - via.y) <=
              (via.diameter + span.diameter) / 2 + 1e-6,
        )
      )
    })
    if (hasJunction) continue
    for (const displacement of DISPLACEMENTS) {
      for (let direction = 0; direction < 16; direction++) {
        if (++candidateCount > MAX_CANDIDATE_EVALUATIONS) return routes
        const angle = (direction * Math.PI) / 8
        const x = via.x + displacement * Math.cos(angle)
        const y = via.y + displacement * Math.sin(angle)
        const candidate = [...routes]
        candidate[routeIndex] = {
          ...route,
          route: route.route.map((point, index) =>
            pointIndices.has(index) ? { ...point, x, y } : point,
          ),
          vias: route.vias.map((point) =>
            point.x === via.x && point.y === via.y ? { ...point, x, y } : point,
          ),
        }
        if (
          getNewViaPadViolations({
            srj: { ...inputSrj, traces: undefined },
            previousRoutes: routes,
            routes: candidate,
          }).length > 0
        )
          continue
        if (evaluate(convert(candidate)).errors.length > 0) continue
        const validator = new TraceWidthSolver({
          hdRoutes: [...otherHdRoutes, ...candidate],
          connection: connections,
          obstacles: inputSrj.obstacles,
          connMap,
          minTraceWidth: inputSrj.minTraceWidth,
          obstacleMargin: inputSrj.minTraceToPadEdgeClearance ?? 0.15,
          minTraceToHoleEdgeClearance: inputSrj.minTraceToHoleEdgeClearance,
          layerCount: inputSrj.layerCount,
        })
        if (validator.getMinimumClearanceViolation(candidate) === null) {
          return candidate
        }
      }
    }
  }
  return routes
}
