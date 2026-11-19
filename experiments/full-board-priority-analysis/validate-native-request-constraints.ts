import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/capacity-autorouter"
import { getFanoutExitPositionConfig } from "./lib/fanout-exit-position"
import { pointIsInsideObstacle } from "./lib/geometry"
import { obstacleSharesElectricalNet } from "./lib/net-identity"
import { prepareFanoutBuses } from "./lib/prepare-buses"
import type { FanoutBusSpec, FanoutDirection, FanoutSolverOptions, Point2D } from "./lib/types"

type RequestName = string
type RequestConstraintViolation = {
  connectionName: RequestName
  traceId: string
  code: "unknown-request" | "wire-width" | "explicit-lead-direction" | "plane-landing"
  expectedWidth?: number
  actualWidths?: number[]
  targetLayer?: string
  viaCenters?: Point2D[]
  requiredDirection?: string
  signedAxisTravel?: number | null
}

function getSignedLeadTravel(
  lead: { start: Point2D; end: Point2D },
  direction: FanoutDirection,
): number {
  switch (direction) {
    case "left": return lead.start.x - lead.end.x
    case "right": return lead.end.x - lead.start.x
    case "up": return lead.end.y - lead.start.y
    case "down": return lead.start.y - lead.end.y
  }
}

/** Audit emitted copper against the original request, independently of search. */
export function validateNativeRequestConstraints(params: {
  inputSrj: SimpleRouteJson
  solverOptions: FanoutSolverOptions
  traces: SimplifiedPcbTrace[]
}): {
  valid: boolean
  checkedTraceCount: number
  checkedWireCount: number
  checkedExplicitLeads: number
  checkedPlaneLandings: number
  violations: RequestConstraintViolation[]
} {
  const { inputSrj, solverOptions, traces } = params
  const specs = (solverOptions.buses ?? inputSrj.buses ?? []) as FanoutBusSpec[]
  const byRequest = new Map(
    prepareFanoutBuses(inputSrj, solverOptions).flatMap((bus) =>
      bus.connections.map((connection) => [
        connection.connection.name,
        { bus, connection },
      ] as const),
    ),
  )
  const violations: RequestConstraintViolation[] = []
  let checkedWireCount = 0
  let checkedExplicitLeads = 0
  let checkedPlaneLandings = 0
  for (const trace of traces) {
    if (trace.route.some((point) =>
      point.route_type !== "wire" && point.route_type !== "via"
    )) throw new Error(`Unsupported native fanout route in ${trace.pcb_trace_id}`)
    const request = byRequest.get(trace.connection_name)
    const identity = {
      connectionName: trace.connection_name,
      traceId: trace.pcb_trace_id,
    }
    if (!request) {
      violations.push({ ...identity, code: "unknown-request" })
      continue
    }
    const { bus, connection } = request
    const original = connection.connection as typeof connection.connection & {
      width?: number
    }
    const expectedWidth = Math.max(
      inputSrj.minTraceWidth,
      solverOptions.traceWidth ?? original.nominalTraceWidth ?? original.width ??
        inputSrj.nominalTraceWidth ?? inputSrj.minTraceWidth,
    )
    const wires = trace.route.filter((point) => point.route_type === "wire")
    checkedWireCount += wires.length
    const actualWidths = [...new Set(wires.map((point) => point.width))]
    if (actualWidths.some((width) => Math.abs(width - expectedWidth) > 1e-9)) {
      violations.push({
        ...identity, code: "wire-width", expectedWidth, actualWidths,
      })
    }
    if (bus.termination.type === "plane") {
      const targetLayer = bus.termination.layer
      const targetPours = inputSrj.obstacles.filter((obstacle) =>
        obstacle.isCopperPour && obstacle.layers.includes(targetLayer),
      )
      const sameNetPours = targetPours.filter((obstacle) =>
        obstacleSharesElectricalNet(inputSrj, obstacle, trace.connection_name),
      )
      const terminalVias = trace.route
        .filter((point) => point.route_type === "via")
        .filter((via) =>
          via.from_layer === targetLayer || via.to_layer === targetLayer,
        )
      checkedPlaneLandings += terminalVias.length
      if (
        terminalVias.length === 0 ||
        targetPours.length > 0 && terminalVias.some((via) =>
          !sameNetPours.some((pour) => pointIsInsideObstacle(via, pour)),
        )
      ) {
        violations.push({
          ...identity, code: "plane-landing", targetLayer,
          viaCenters: terminalVias.map(({ x, y }) => ({ x, y })),
        })
      }
    }
    const spec = specs.find((candidate) => candidate.busId === bus.busId)
    const requiredDirection = spec?.exitPosition
      ? getFanoutExitPositionConfig(spec.exitPosition).direction
      : solverOptions.busDirections?.[bus.busId] ?? spec?.direction ??
        solverOptions.defaultDirection
    if (!requiredDirection) continue
    checkedExplicitLeads++
    let previous: Point2D | undefined
    let lead: { start: Point2D; end: Point2D } | undefined
    let sourceCenteredVia = false
    for (const point of trace.route) {
      if (point.route_type === "via") {
        sourceCenteredVia = Math.hypot(
          point.x - connection.sourcePoint.x,
          point.y - connection.sourcePoint.y,
        ) <= 1e-9
        break
      }
      if (point.route_type !== "wire" || point.layer !== connection.sourceLayer) continue
      if (
        previous &&
        Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-9 &&
        !pointIsInsideObstacle(point, connection.sourceObstacle)
      ) {
        lead = { start: previous, end: { x: point.x, y: point.y } }
        break
      }
      previous = { x: point.x, y: point.y }
    }
    if (!lead && sourceCenteredVia) continue
    const signedAxisTravel = lead
      ? getSignedLeadTravel(lead, requiredDirection)
      : null
    if (signedAxisTravel === null || signedAxisTravel <= 1e-9) {
      violations.push({
        ...identity, code: "explicit-lead-direction", requiredDirection,
        signedAxisTravel,
      })
    }
  }
  return {
    valid: violations.length === 0,
    checkedTraceCount: traces.length,
    checkedWireCount,
    checkedExplicitLeads,
    checkedPlaneLandings,
    violations,
  }
}
