import { distance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]
type PcbPortId = NonNullable<RoutePoint["pcb_port_id"]>
type TerminalVia = {
  routeIndex: number
  points: RoutePoint[]
  reversed: boolean
  transitionIndex: number
}

/** Proposes a shared drill for branches attached to the same physical terminal. */
export function* getPipeline9SharedTerminalViaCandidates(
  routes: HighDensityRoute[],
): Generator<HighDensityRoute[]> {
  const branchesByPort = new Map<PcbPortId, TerminalVia[]>()
  for (const [routeIndex, route] of routes.entries()) {
    if (
      route.jumpers?.length ||
      route.route.some((point) => point.toNextSegmentType || point.insideJumperPad)
    ) {
      continue
    }
    for (const reversed of [false, true]) {
      let points = route.route
      if (reversed) points = [...points].reverse()
      const terminal = points[0]
      if (!terminal?.pcb_port_id) continue
      const transitionIndex = points.findIndex(
        (point, index) => index > 0 && point.z !== points[index - 1]!.z,
      )
      if (transitionIndex < 1) continue
      const beforeVia = points[transitionIndex - 1]!
      const afterVia = points[transitionIndex]!
      if (
        beforeVia.x !== afterVia.x ||
        beforeVia.y !== afterVia.y ||
        points.slice(1, transitionIndex + 1).some((point) => point.pcb_port_id) ||
        points.slice(0, transitionIndex + 1).some(
          (point) =>
            point.traceThickness !== undefined &&
            point.traceThickness !== route.traceThickness,
        ) ||
        points.slice(transitionIndex + 1).some(
          (point) => point.x === afterVia.x && point.y === afterVia.y,
        )
      ) {
        continue
      }
      const branches = branchesByPort.get(terminal.pcb_port_id) ?? []
      branches.push({ routeIndex, points, reversed, transitionIndex })
      branchesByPort.set(terminal.pcb_port_id, branches)
    }
  }

  for (const branches of branchesByPort.values()) {
    branches.sort(
      (left, right) =>
        distance(left.points[0]!, left.points[left.transitionIndex]!) -
        distance(right.points[0]!, right.points[right.transitionIndex]!),
    )
    for (const branch of [...branches].reverse()) {
      const terminal = branch.points[0]!
      const via = branch.points[branch.transitionIndex]!
      for (const anchor of branches) {
        const anchorTerminal = anchor.points[0]!
        const sharedVia = anchor.points[anchor.transitionIndex]!
        if (
          branch.routeIndex === anchor.routeIndex ||
          terminal.x !== anchorTerminal.x ||
          terminal.y !== anchorTerminal.y ||
          terminal.z !== anchorTerminal.z ||
          routes[branch.routeIndex]!.viaDiameter !==
            routes[anchor.routeIndex]!.viaDiameter ||
          (via.x === sharedVia.x && via.y === sharedVia.y)
        ) {
          continue
        }
        const sharedPoints = [
          terminal,
          { x: sharedVia.x, y: sharedVia.y, z: terminal.z },
          { x: sharedVia.x, y: sharedVia.y, z: via.z },
          ...branch.points.slice(branch.transitionIndex + 1),
        ]
        if (branch.reversed) sharedPoints.reverse()
        const candidate = [...routes]
        candidate[branch.routeIndex] = {
          ...routes[branch.routeIndex]!,
          route: sharedPoints,
          vias: routes[branch.routeIndex]!.vias.map((point) => {
            if (point.x !== via.x || point.y !== via.y) return point
            return { x: sharedVia.x, y: sharedVia.y }
          }),
        }
        yield candidate
      }
    }
  }
}
