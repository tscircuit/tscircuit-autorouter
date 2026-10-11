import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { findPhysicalStitchPath, type PhysicalStitchPathOptions } from "lib/solvers/RouteStitchingSolver/findPhysicalStitchPath"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("physical stitch search follows the terminal branch and records only permitted exact vias", (): void => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "branch", traceThickness: 0.15, viaDiameter: 0.3, route: [
      { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
    ], vias: [], startPcbPortId: "start" },
    { connectionName: "branch", traceThickness: 0.15, viaDiameter: 0.3, route: [
      { x: 2, y: 0, z: 0 }, { x: 2, y: -2, z: 0 },
    ], vias: [] },
    { connectionName: "branch", traceThickness: 0.15, viaDiameter: 0.3, route: [
      { x: 2, y: 0, z: 1 }, { x: 4, y: 0, z: 1 },
    ], vias: [], endPcbPortId: "end" },
  ]
  const original = structuredClone(routes)
  const opts: PhysicalStitchPathOptions = {
    connectionName: "branch", hdRoutes: routes,
    start: { x: 0, y: 0, z: 0, pcb_port_id: "start" },
    end: { x: 4, y: 0, z: 1, pcb_port_id: "end" }, traceThickness: 0.15,
    allowedLayerTransitionPointKeys: new Set([getXyPointKey({ x: 2, y: 0 })]),
    isStitchSegmentClear: () => true, stitchClearanceMode: "require_clear",
  }
  const path = findPhysicalStitchPath(opts)
  expect(path).not.toBeNull()
  expect(path!.routeIndexes).toEqual([0, 2])
  expect(path!.route.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
    { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 1 }, { x: 4, y: 0, z: 1 },
  ])
  expect(path!.vias).toEqual([{ x: 2, y: 0 }])
  expect(findPhysicalStitchPath({ ...opts, allowedLayerTransitionPointKeys: new Set() })).toBeNull()
  const reordered = findPhysicalStitchPath({ ...opts, hdRoutes: routes.toReversed() })
  expect(reordered!.route).toEqual(path!.route)
  expect(reordered!.vias).toEqual(path!.vias)
  expect(routes).toEqual(original)

  const annotated: HighDensityIntraNodeRoute = {
    connectionName: "annotation", traceThickness: 0.2, viaDiameter: 0.4,
    route: [{ x: 4, y: 0, z: 0, toNextSegmentType: "through_obstacle",
      toNextSegmentCircuitJsonMetadata: { pcb_smtpad_id: "bridge" } }, { x: 0, y: 0, z: 0 }],
    vias: [], jumpers: [{ route_type: "jumper", start: { x: 4, y: 0 }, end: { x: 0, y: 0 }, footprint: "0603" }],
  }
  const reversed = findPhysicalStitchPath({ ...opts, connectionName: "annotation", hdRoutes: [annotated],
    start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 } })
  expect(reversed!.route[0]!.toNextSegmentType).toBe("through_obstacle")
  expect(reversed!.route[0]!.toNextSegmentCircuitJsonMetadata).toEqual({ pcb_smtpad_id: "bridge" })
  expect(reversed!.route.at(-1)!.toNextSegmentType).toBeUndefined()
  expect(reversed!.jumpers).toEqual([{ route_type: "jumper", start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, footprint: "0603" }])

  const terminalGap = { ...opts, hdRoutes: [routes[0]!],
    end: { x: 3.1, y: 0, z: 1, pcb_port_id: "end" },
    allowedLayerTransitionPointKeys: new Set([getXyPointKey({ x: 3.1, y: 0 })]) }
  const withTerminalVia = findPhysicalStitchPath(terminalGap)
  expect(withTerminalVia).not.toBeNull()
  expect(withTerminalVia!.route.at(-1)).toEqual({ x: 3.1, y: 0, z: 1 })
  expect(withTerminalVia!.vias).toEqual([{ x: 3.1, y: 0 }])
  expect(findPhysicalStitchPath({ ...terminalGap, isStitchSegmentClear: () => false })).toBeNull()
  expect(findPhysicalStitchPath({ ...terminalGap, isStitchSegmentClear: () => false,
    stitchClearanceMode: "prefer_clear" })).not.toBeNull()
  expect(findPhysicalStitchPath({ ...opts, hdRoutes: [] })).toBeNull()

  const gapRoutes: HighDensityIntraNodeRoute[] = [
    { ...routes[0]!, startPcbPortId: undefined },
    { ...routes[2]!, endPcbPortId: undefined, route: [{ x: 3.6, y: 0, z: 0 }, { x: 5.6, y: 0, z: 0 }] },
    { ...routes[1]!, route: [{ x: 2.8, y: 0, z: 0, insideJumperPad: true,
      toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: { pcb_smtpad_id: "unused-pad" } },
    { x: 2.8, y: -4, z: 0 }] },
  ]
  const throughUnusedEndpoint = findPhysicalStitchPath({ ...opts, hdRoutes: gapRoutes,
    start: { x: 0, y: 0, z: 0 }, end: { x: 5.6, y: 0, z: 0 } })
  expect(throughUnusedEndpoint!.routeIndexes).toEqual([0, 1])
  const connectorPoint = throughUnusedEndpoint!.route.find((point) => point.x === 2.8 && point.y === 0)
  expect(connectorPoint).toEqual({ x: 2.8, y: 0, z: 0 })
  expect(throughUnusedEndpoint!.route.every((point) => !point.toNextSegmentType &&
    !point.toNextSegmentCircuitJsonMetadata && !point.insideJumperPad)).toBe(true)

  const longer: HighDensityIntraNodeRoute = { ...routes[0]!, route: [
    { x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 },
    { x: 4, y: 5, z: 0 }, { x: 4, y: 0, z: 0 },
  ] }
  const shorter: HighDensityIntraNodeRoute = { ...routes[0]!, route: [
    { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 },
  ] }
  const shortest = findPhysicalStitchPath({ ...opts, hdRoutes: [longer, shorter],
    end: { x: 4, y: 0, z: 0, pcb_port_id: "end" } })
  expect(shortest!.routeIndexes).toEqual([1])
  expect(shortest!.route).toEqual(shorter.route)
  const branch = (y: number): HighDensityIntraNodeRoute => ({ ...shorter, route: [
    { x: 0, y: 0, z: 0 }, { x: 0, y, z: 0 },
    { x: 4, y, z: 0 }, { x: 4, y: 0, z: 0 },
  ] })
  const clearer = findPhysicalStitchPath({ ...opts, hdRoutes: [branch(-1), branch(1)],
    end: { x: 4, y: 0, z: 0, pcb_port_id: "end" },
    isStitchSegmentClear: ({ start, end }): boolean => !(start.y < 0 && end.y < 0) })
  expect(clearer!.routeIndexes).toEqual([1])
})
