import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Pipeline9ParametricInterfacePort } from "./Pipeline9ParametricInterfaceIndex"

type Point = HighDensityRoute["route"][number]
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Params = {
  node: NodeWithPortPoints
  pair: readonly [PortPoint, PortPoint]
  traceWidth: number
  viaDiameter: number
  clearance: number
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  interfacePortPoints: readonly Pipeline9ParametricInterfacePort[]
}
export type Pipeline9CellInterfaceSupport = {
  coreEndpoints: readonly [Point, Point]
  viaCore: Bounds | null
  terminalEscapeCount: number
  reservationChecks: number
  inheritedTerminalContacts: number
  certify: (route: HighDensityRoute) => boolean
}

/**
 * Certifies optional copper's clearance-expanded support inside one cell.
 * A normal lead is the sole exception: its exterior support is already forced
 * by the exact original clearance-expanded terminal disk. This is conditional composition with
 * contained neighboring copper, not a bound on every native solver's output.
 */
export function createPipeline9CellInterfaceSupport(params: Params): Pipeline9CellInterfaceSupport | null {
  const { node, pair, traceWidth, viaDiameter, clearance } = params
  if (![node.center.x, node.center.y, node.width, node.height, traceWidth, viaDiameter, clearance].every(Number.isFinite) || node.width <= 0 || node.height <= 0 || traceWidth <= 0 || viaDiameter <= 0 || clearance < 0 || !Number.isInteger(params.layerCount) || params.layerCount < 1 || pair.some((port) => ![port.x, port.y].every(Number.isFinite) || !Number.isInteger(port.z) || port.z < 0 || port.z >= params.layerCount)) throw new Error("Parametric interface has invalid physical dimensions")
  const cell = { minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2, minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 }
  const inset = traceWidth / 2 + clearance + 1e-6
  const core = { minX: cell.minX + inset, maxX: cell.maxX - inset, minY: cell.minY + inset, maxY: cell.maxY - inset }
  if (core.minX > core.maxX || core.minY > core.maxY) return null
  const inside = (point: Point, bounds: Bounds): boolean => point.x >= bounds.minX - 1e-9 && point.x <= bounds.maxX + 1e-9 && point.y >= bounds.minY - 1e-9 && point.y <= bounds.maxY + 1e-9
  const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y && a.z === b.z
  const coreEndpoints: Point[] = []
  const leads: Array<readonly [Point, Point]> = []
  for (const endpoint of pair) {
    const witness = node.portPoints.find((port) => port.portPointId === endpoint.portPointId && port.pcb_port_id === endpoint.pcb_port_id && port.connectionName === endpoint.connectionName && (port.rootConnectionName ?? port.connectionName) === (endpoint.rootConnectionName ?? endpoint.connectionName) && same(port, endpoint))
    if (!witness) throw new Error("Parametric interface terminal has no exact serialized owner witness")
    if (!params.interfacePortPoints.some((entry) => entry.capacityMeshNodeId === node.capacityMeshNodeId && entry.traceWidth === traceWidth && entry.port.portPointId === endpoint.portPointId && entry.port.pcb_port_id === endpoint.pcb_port_id && entry.port.connectionName === endpoint.connectionName && (entry.port.rootConnectionName ?? entry.port.connectionName) === (endpoint.rootConnectionName ?? endpoint.connectionName) && same(entry.port, endpoint))) throw new Error("Parametric interface terminal is missing from the immutable scene reservations")
    if (!inside(endpoint, cell)) return null
    if (inside(endpoint, core)) {
      coreEndpoints.push({ x: endpoint.x, y: endpoint.y, z: endpoint.z })
      continue
    }
    // A corner needs a two-axis escape whose support is not implied by its
    // endpoint disk. It is outside this finite contract, before dispatch.
    const xOutside = endpoint.x < core.minX || endpoint.x > core.maxX
    const yOutside = endpoint.y < core.minY || endpoint.y > core.maxY
    if (xOutside === yOutside || !(endpoint.portPointId?.length || endpoint.pcb_port_id?.length)) return null
    const projected = { x: Math.max(core.minX, Math.min(core.maxX, endpoint.x)), y: Math.max(core.minY, Math.min(core.maxY, endpoint.y)), z: endpoint.z }
    coreEndpoints.push(projected)
    leads.push([endpoint, projected])
  }
  const viaInset = viaDiameter / 2 + clearance + 1e-6
  const viaBounds = { minX: cell.minX + viaInset, maxX: cell.maxX - viaInset, minY: cell.minY + viaInset, maxY: cell.maxY - viaInset }
  const viaCore = viaBounds.minX <= viaBounds.maxX && viaBounds.minY <= viaBounds.maxY ? viaBounds : null
  const support: Pipeline9CellInterfaceSupport = {
    coreEndpoints: [coreEndpoints[0]!, coreEndpoints[1]!], viaCore, terminalEscapeCount: leads.length, reservationChecks: 0, inheritedTerminalContacts: 0,
    certify(route: HighDensityRoute): boolean {
      if (route.connectionName !== pair[0].connectionName || (route.rootConnectionName ?? route.connectionName) !== (pair[0].rootConnectionName ?? pair[0].connectionName) || pair[0].connectionName !== pair[1].connectionName || (pair[0].rootConnectionName ?? pair[0].connectionName) !== (pair[1].rootConnectionName ?? pair[1].connectionName) || !route.route.length || !same(route.route[0]!, pair[0]) || !same(route.route.at(-1)!, pair[1])) throw new Error("Parametric interface route changed its declared terminal identity")
      const geometry = getPipeline9RouteCopperGeometry(route, params)
      for (const wire of geometry.wireSegments) {
        if (wire.width !== traceWidth) throw new Error("Parametric interface route changed its certified width")
        const lead = leads.find(([terminal, projected]) => (same(wire.start, terminal) && same(wire.end, projected)) || (same(wire.end, terminal) && same(wire.start, projected)))
        // Match the entire exact normal lead, in either traversal direction.
        // No arbitrary first segment, sampled vertex or endpoint neighborhood
        // receives an exemption from the support containment requirement.
        if (!(inside(wire.start, core) && inside(wire.end, core)) && !lead) return false
        for (const entry of params.interfacePortPoints) {
          if (entry.port.z !== wire.z || (entry.port.rootConnectionName ?? entry.port.connectionName) === (route.rootConnectionName ?? route.connectionName)) continue
          support.reservationChecks++
          const separation = (wire.width + entry.traceWidth) / 2 + clearance + 1e-6
          const distance = pointToSegmentDistance(entry.port, wire.start, wire.end)
          if (distance >= separation) continue
          // This exact normal lead can inherit its mandatory endpoint contact;
          // it cannot create a contact with a previously separated terminal.
          // Optional core copper receives no such exception, even on that net.
          const terminalDistance = lead ? Math.hypot(entry.port.x - lead[0].x, entry.port.y - lead[0].y) : Infinity
          const rounding = 64 * Number.EPSILON * Math.max(1, Math.abs(entry.port.x), Math.abs(entry.port.y), Math.abs(wire.start.x), Math.abs(wire.start.y), Math.abs(wire.end.x), Math.abs(wire.end.y))
          if (lead && terminalDistance < separation && distance + rounding >= terminalDistance) {
            support.inheritedTerminalContacts++
            continue
          }
          return false
        }
      }
      for (const via of geometry.viaSpans) {
        if (via.diameter !== viaDiameter) throw new Error("Parametric interface route changed its certified via diameter")
        if (!viaCore || !inside({ ...via.center, z: via.minZ }, viaCore)) return false
        for (const entry of params.interfacePortPoints) {
          if (entry.port.z < via.minZ || entry.port.z > via.maxZ || (entry.port.rootConnectionName ?? entry.port.connectionName) === (route.rootConnectionName ?? route.connectionName)) continue
          support.reservationChecks++
          if (Math.hypot(entry.port.x - via.center.x, entry.port.y - via.center.y) < (via.diameter + entry.traceWidth) / 2 + clearance + 1e-6) return false
        }
      }
      return true
    },
  }
  return support
}
