import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { selectDeclaredTerminalPath } from "lib/solvers/RouteStitchingSolver/selectDeclaredTerminalPath"
import { reverseRoutePoints } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("rounded declared terminals attach to their owned PCB roles and cannot replace an existing detour with a broad gap", (): void => {
  const start = { x: -21.1259568, y: 6.249936, z: 0, pcb_port_id: "pcb_port_59" }
  const end = { x: -21.1259568, y: 5.249938, z: 0, pcb_port_id: "pcb_port_61" }
  const base = { connectionName: "source_net_12_mst0", rootConnectionName: "source_net_12", traceThickness: 0.15, viaDiameter: 0.5, vias: [] }
  // Exact endpoint/role witnesses captured from the three connected Muse HD
  // fragments. The intervening detour is shortened to a planar rectangle here.
  const routes: HighDensityRoute[] = [
    { ...base, regionId: "start", startPcbPortId: start.pcb_port_id, route: [{ x: -21.126, y: 6.25, z: 0 }, { x: -21.776, y: 6.25, z: 0 }] },
    { ...base, regionId: "middle", route: [{ x: -21.776, y: 6.25, z: 0 }, { x: -21.776, y: 5.372, z: 0 }] },
    { ...base, regionId: "end", endPcbPortId: end.pcb_port_id, route: [{ x: -21.776, y: 5.372, z: 0 }, { x: -21.126, y: 5.25, z: 0 }] },
  ]
  const foreign: HighDensityRoute = { connectionName: "foreign-pad-copper", traceThickness: 0.3, viaDiameter: 0.5, vias: [], route: [{ x: -21.3, y: 5.75, z: 0 }, { x: -20.95, y: 5.75, z: 0 }] }
  const oldShortcut: HighDensityRoute = { ...base, route: [start, routes[2]!.route.at(-1)!, end] }
  expect(doPipeline9RoutesHaveCopperConflict({ left: oldShortcut, right: foreign, layerCount: 2, clearance: 0 })).toBe(true)
  for (const reversed of [false, true]) {
    const oriented = reversed ? routes.slice().reverse().map((route) => ({ ...route, route: reverseRoutePoints(route.route), startPcbPortId: route.endPcbPortId, endPcbPortId: route.startPcbPortId })) : routes
    const selected = selectDeclaredTerminalPath({ connectionName: base.connectionName, routes: oriented, start, end })
    expect(selected.filter((route) => route.regionId !== undefined).map((route) => route.regionId)).toEqual(["start", "middle", "end"])
    expect(selected[0]!.route[0]).toEqual({ x: start.x, y: start.y, z: start.z })
    expect(selected.at(-1)!.route.at(-1)).toEqual({ x: end.x, y: end.y, z: end.z })
    expect(selected.every((route) => !doPipeline9RoutesHaveCopperConflict({ left: route, right: foreign, layerCount: 2, clearance: 0 }))).toBe(true)
    const solver = new MultipleHighDensityRouteStitchSolver3({ connections: [{ name: base.connectionName, pointsToConnect: [{ ...start, layer: "top" }, { ...end, layer: "top" }] }], hdRoutes: oriented, layerCount: 2, preserveTerminalPcbPortIds: true, useDeclaredConnectionEndpoints: true })
    solver.solve()
    expect(solver.solved).toBe(true)
    const result = solver.mergedHdRoutes[0]!
    expect(result.route[0]).toEqual(start)
    expect(result.route.at(-1)).toEqual(end)
    expect(result.startPcbPortId).toBe(start.pcb_port_id)
    expect(result.endPcbPortId).toBe(end.pcb_port_id)
    expect(doPipeline9RoutesHaveCopperConflict({ left: result, right: foreign, layerCount: 2, clearance: 0 })).toBe(false)
  }
  const wrongLayer = structuredClone(routes)
  wrongLayer[0]!.route[0]!.z = 1
  expect(() => selectDeclaredTerminalPath({ connectionName: base.connectionName, routes: wrongLayer, start, end })).toThrow("no compatible pcb_port_59")
  const untagged = { ...base, connectionName: "untagged" }
  const ambiguous: HighDensityRoute[] = [
    { ...untagged, route: [{ x: -1, y: 0, z: 0 }, { x: -1, y: 1, z: 0 }] },
    { ...untagged, route: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] },
  ]
  expect(() => selectDeclaredTerminalPath({ connectionName: "untagged", routes: ambiguous, start: { x: 0, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } })).toThrow("ambiguous untagged")
  const rounded = selectDeclaredTerminalPath({ connectionName: "untagged", routes: [{ ...untagged, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] }], start: { x: 0.00004, y: 0.00004, z: 0 }, end: { x: 0.99996, y: 0, z: 0 } })
  expect(rounded).toHaveLength(3)
  expect(rounded[1]!.route).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])
})
