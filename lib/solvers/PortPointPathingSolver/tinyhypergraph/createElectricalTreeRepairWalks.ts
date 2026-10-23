import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { reverseRoutePoints } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { getElectricalTreeTerminalWitness } from "./getElectricalTreeTerminalWitness"

type Occurrence = { walk: number; point: number }
type Branch = { index: number; start: string; end: string }

/** Producer-owned adjacency identity; coordinate coincidence never creates one. */
export type ElectricalTreeRepairSegmentIdentity =
  | { kind: "physical"; sourceRouteIndex: number; sourceSegmentIndex: number; reversed: boolean }
  | { kind: "adapter-seam" }

/** A temporary closed walk makes a free tree junction an interior variable. */
export function createElectricalTreeRepairWalks(input: {
  connections: SimpleRouteConnection[]
  routes: HighDensityRoute[]
  /** Required when validating source SRJ terminal witnesses without pad IDs. */
  layerCount?: number
}): { routes: HighDensityRoute[]; lockedPointIndices: boolean[][]; segmentIdentityByRoute: ElectricalTreeRepairSegmentIdentity[][]; decode: (walks: HighDensityRoute[]) => HighDensityRoute[]; junctionCount: number } {
  const connectionByName = new Map(input.connections.map((connection) => [connection.name, connection]))
  const occurrences: Occurrence[][][] = input.routes.map((route) => route.route.map(() => []))
  const branches: Branch[] = []
  const incident = new Map<string, Branch[]>()
  const pads = new Set<string>()
  const immutableEndpoints = new Set<string>()
  const walks: HighDensityRoute[] = []
  const segmentIdentityByRoute: ElectricalTreeRepairSegmentIdentity[][] = []
  for (let index = 0; index < input.routes.length; index++) {
    const route = input.routes[index]!
    const connection = connectionByName.get(route.connectionName)
    if (connection?.electricalBranch?.nativeLogicalPath) {
      for (const endpoint of [0, 1] as const) {
        const witness = getElectricalTreeTerminalWitness(connection, endpoint, input.layerCount)
        const pointIndex = endpoint === 0 ? 0 : route.route.length - 1
        const actual = route.route[pointIndex]
        if (witness && (!actual || actual.x !== witness.x || actual.y !== witness.y || actual.z !== witness.z)) throw new Error(`Electrical tree repair received a moved original terminal on ${connection.name}`)
        if (witness || connection.pointsToConnect[endpoint]!.pcb_port_id) immutableEndpoints.add(`${index}:${pointIndex}`)
      }
    }
    if (!connection?.electricalBranch || connection.electricalBranch.nativeLogicalPath) {
      const walk = walks.length
      walks.push(structuredClone(route))
      segmentIdentityByRoute.push(route.route.slice(1).map((_, sourceSegmentIndex) => ({ kind: "physical", sourceRouteIndex: index, sourceSegmentIndex, reversed: false })))
      route.route.forEach((_, point) => occurrences[index]![point]!.push({ walk, point }))
      continue
    }
    const branch: Branch = { index, start: connection.electricalBranch.startVertexId, end: connection.electricalBranch.endVertexId }
    branches.push(branch)
    for (const [vertex, endpoint] of [[branch.start, 0], [branch.end, 1]] as const) {
      const edges = incident.get(vertex) ?? []
      edges.push(branch)
      incident.set(vertex, edges)
      const point = connection.pointsToConnect[endpoint]!, witness = getElectricalTreeTerminalWitness(connection, endpoint, input.layerCount)
      if (point.pcb_port_id || witness) {
        pads.add(vertex)
        const pointIndex = endpoint === 0 ? 0 : route.route.length - 1
        const actual = route.route[pointIndex]
        if (witness && (!actual || actual.x !== witness.x || actual.y !== witness.y || actual.z !== witness.z)) throw new Error(`Electrical tree repair received a moved original terminal on ${connection.name}`)
        immutableEndpoints.add(`${index}:${pointIndex}`)
      }
    }
  }
  const visited = new Set<number>()
  for (const first of branches) {
    if (visited.has(first.index)) continue
    const component = new Set<string>()
    const pending = [first.start]
    while (pending.length > 0) {
      const vertex = pending.pop()!
      if (component.has(vertex)) continue
      component.add(vertex)
      for (const edge of incident.get(vertex)!) pending.push(edge.start === vertex ? edge.end : edge.start)
    }
    const root = [...component].find((vertex) => pads.has(vertex))
    if (!root) throw new Error("Electrical tree repair component has no immutable declared terminal")
    const routePoints: HighDensityRoute["route"] = []
    const segmentIdentities: ElectricalTreeRepairSegmentIdentity[] = []
    const walkIndex = walks.length
    const append = (edge: Branch, forward: boolean): void => {
      const route = input.routes[edge.index]!
      const oriented = forward ? route.route : reverseRoutePoints(route.route)
      for (let point = 0; point < oriented.length; point++) {
        const value = oriented[point]!
        const previous = routePoints.at(-1)
        // No synthetic connecting copper is permitted by this adapter.
        if (point === 0 && previous && (previous.x !== value.x || previous.y !== value.y || previous.z !== value.z)) {
          throw new Error(`Electrical tree repair walk has a disconnected branch ${route.connectionName}`)
        }
        const outputPoint = routePoints.length
        if (previous) {
          segmentIdentities.push(point === 0
            ? { kind: "adapter-seam" }
            : { kind: "physical", sourceRouteIndex: edge.index,
              sourceSegmentIndex: forward ? point - 1 : route.route.length - point - 1,
              reversed: !forward })
        }
        routePoints.push({ ...value, traceThickness: value.traceThickness ?? route.traceThickness })
        const sourcePoint = forward ? point : route.route.length - point - 1
        occurrences[edge.index]![sourcePoint]!.push({ walk: walkIndex, point: outputPoint })
      }
    }
    const visit = (vertex: string): void => {
      for (const edge of incident.get(vertex)!) {
        if (visited.has(edge.index)) continue
        visited.add(edge.index)
        const forward = edge.start === vertex
        append(edge, forward)
        visit(forward ? edge.end : edge.start)
        append(edge, !forward)
      }
    }
    visit(root)
    const example = input.routes[first.index]!
    const componentEdges = new Set([...component].flatMap((vertex) => incident.get(vertex)!.map((edge) => edge.index)))
    const viaDiameter = [...componentEdges].reduce((maximum, index) => Math.max(maximum, input.routes[index]!.viaDiameter), 0)
    walks.push({ ...example, viaDiameter, route: routePoints, vias: [], startPcbPortId: routePoints[0]?.pcb_port_id, endPcbPortId: routePoints.at(-1)?.pcb_port_id })
    segmentIdentityByRoute.push(segmentIdentities)
  }
  const decode = (outputWalks: HighDensityRoute[]): HighDensityRoute[] => {
    if (outputWalks.length !== walks.length) throw new Error("Electrical tree repair lost a walk")
    const output = input.routes.map((route, index) => {
      const points = route.route.map((point, pointIndex) => {
        const refs = occurrences[index]![pointIndex]!
        if (refs.length === 0) throw new Error("Electrical tree repair lost a physical point")
        const moved = outputWalks[refs[0]!.walk]!.route[refs[0]!.point]!
        if (!moved || moved.z !== point.z || refs.some((ref) => {
          const copy = outputWalks[ref.walk]!.route[ref.point]
          return !copy || copy.x !== moved.x || copy.y !== moved.y || copy.z !== moved.z
        })) throw new Error("Electrical tree repair moved shared occurrences inconsistently")
        if ((point.pcb_port_id || immutableEndpoints.has(`${index}:${pointIndex}`)) && (point.x !== moved.x || point.y !== moved.y || (point.pcb_port_id !== undefined && moved.pcb_port_id !== point.pcb_port_id))) {
          throw new Error(`Electrical tree repair moved immutable terminal on ${route.connectionName}`)
        }
        return { ...point, x: moved.x, y: moved.y }
      })
      const vias: HighDensityRoute["vias"] = []
      for (let point = 1; point < points.length; point++) {
        const a = points[point - 1]!, b = points[point]!
        if (a.z === b.z || a.toNextSegmentType === "through_obstacle") continue
        if (a.x !== b.x || a.y !== b.y) throw new Error("Electrical tree repair created a diagonal via")
        if (!vias.some((via) => via.x === b.x && via.y === b.y)) vias.push({ x: b.x, y: b.y })
      }
      return { ...route, route: points, vias }
    })
    const physicalConnections = input.connections.filter((connection) => connection.electricalBranch)
    const outputByName = new Map(output.map((route) => [route.connectionName, route]))
    const positions = new Map<string, HighDensityRoute["route"][number]>()
    for (const connection of physicalConnections) {
      const branch = connection.electricalBranch!
      for (const index of [0, 1] as const) {
        const id = index === 0 ? branch.startVertexId : branch.endVertexId
        const route = outputByName.get(connection.name)
        if (!route) throw new Error(`Electrical tree repair lost branch ${connection.name}`)
        const point = index === 0 ? route.route[0]! : route.route.at(-1)!
        const previous = positions.get(id)
        if (previous && (previous.x !== point.x || previous.y !== point.y || previous.z !== point.z)) throw new Error(`Electrical tree repair disconnected vertex ${id}`)
        positions.set(id, point)
      }
    }
    return output
  }
  const lockedPointIndices = walks.map((route) => route.route.map(() => false))
  for (const key of immutableEndpoints) {
    const [route, point] = key.split(":").map(Number)
    for (const occurrence of occurrences[route!]![point!]!) lockedPointIndices[occurrence.walk]![occurrence.point] = true
  }
  return { routes: walks, lockedPointIndices, segmentIdentityByRoute, decode, junctionCount: [...incident].filter(([vertex, edges]) => edges.length > 1 && !pads.has(vertex)).length }
}
