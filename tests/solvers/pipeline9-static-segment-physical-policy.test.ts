import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import { getPipeline9PhysicalGeometryContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalGeometryContext"
import type { SimpleRouteJson } from "lib/types"
import type { StaticRouteSegment } from "lib/types/high-density-types"

test("indexed static edges preserve physical span, ownership, typed clearances and whole-guard decisions", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 8,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0.8,
    connections: [
      { name: "signal", pointsToConnect: [] },
      { name: "foreign", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["inner4"],
        connectedTo: ["foreign", "pcb_smtpad_foreign"],
      },
    ],
  }
  const via: StaticRouteSegment = {
    connectionName: "signal",
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 1 },
  }
  const compare = (
    board: SimpleRouteJson,
    edge: StaticRouteSegment,
  ): boolean => {
    const actual = createPipeline9StaticSegmentValidator(board)(edge)
    const whole = createPipeline9PhysicalRouteValidator({
      physicalSrj: board,
      connMap: new ConnectivityMap({}),
      obstacleMargin: 0.8,
    })([
      {
        connectionName: edge.connectionName,
        rootConnectionName: edge.rootConnectionName,
        traceThickness: edge.traceThickness,
        viaDiameter: edge.viaDiameter,
        route: [edge.start, edge.end],
        vias:
          edge.start.z !== edge.end.z
            ? [{ x: edge.start.x, y: edge.start.y }]
            : [],
      },
    ])
    expect(actual).toBe(whole)
    return actual
  }
  const original = structuredClone({ srj, via })
  expect(compare(srj, via)).toBe(false)
  expect(compare({ ...srj, allowBlindAndBuriedVias: true }, via)).toBe(true)
  expect(
    compare(
      { ...srj, allowBlindAndBuriedVias: true },
      { ...via, end: { ...via.end, z: 5 } },
    ),
  ).toBe(false)
  const ownPlated = {
    ...srj,
    obstacles: [
      {
        ...srj.obstacles[0]!,
        layers: [
          "top",
          "inner1",
          "inner2",
          "inner3",
          "inner4",
          "inner5",
          "inner6",
          "bottom",
        ],
        connectedTo: ["signal", "pcb_plated_hole_own"],
      },
    ],
  }
  expect(compare(ownPlated, via)).toBe(true)
  const child = {
    ...via,
    connectionName: "child",
    rootConnectionName: "signal",
  }
  expect(compare(ownPlated, child)).toBe(true)
  const opaque = {
    ...srj,
    obstacles: [
      {
        ...srj.obstacles[0]!,
        center: { x: 0.32, y: 0 },
        connectedTo: [],
        obstacleId: "pcb_keepout_raw",
      },
    ],
  }
  expect(compare(opaque, via)).toBe(true)
  expect(
    compare(opaque, {
      ...via,
      start: { ...via.start, x: 0.03 },
      end: { ...via.end, x: 0.03 },
    }),
  ).toBe(false)
  const wire = {
    ...via,
    traceThickness: 0.02,
    start: { x: -1, y: 0.26, z: 4 },
    end: { x: 1, y: 0.26, z: 4 },
  }
  expect(compare(srj, wire)).toBe(false)
  expect(compare({ ...srj, minTraceWidth: 0.02 }, wire)).toBe(true)
  const rotated = {
    ...srj,
    obstacles: [
      { ...srj.obstacles[0]!, width: 4, height: 1, ccwRotationDegrees: 90 },
    ],
  }
  expect(
    compare(rotated, {
      ...via,
      start: { x: 0, y: 1.5, z: 0 },
      end: { x: 0, y: 1.5, z: 7 },
    }),
  ).toBe(false)
  expect(
    compare(rotated, {
      ...via,
      start: { x: 1.5, y: 0, z: 0 },
      end: { x: 1.5, y: 0, z: 7 },
    }),
  ).toBe(true)
  const hole = {
    ...srj,
    minTraceToHoleEdgeClearance: 0.1,
    obstacles: [
      {
        ...srj.obstacles[0]!,
        width: 1,
        height: 1,
        shape: "circle" as const,
        isNonPlatedHole: true,
        connectedTo: [],
      },
    ],
  }
  const besideHole = {
    ...wire,
    traceThickness: 0.1,
    start: { x: -1, y: 0.65, z: 4 },
    end: { x: 1, y: 0.65, z: 4 },
  }
  expect(compare(hole, besideHole)).toBe(true)
  expect(
    compare({ ...hole, minTraceToHoleEdgeClearance: 0.15 }, besideHole),
  ).toBe(false)
  for (const x of [0, 0.15, 0.3, 0.395, 0.4, 0.45])
    compare(srj, { ...via, start: { ...via.start, x }, end: { ...via.end, x } })
  expect(createPipeline9StaticSegmentValidator(srj)).toBe(
    createPipeline9StaticSegmentValidator(srj),
  )
  expect(getPipeline9PhysicalGeometryContext(srj)).toBe(
    getPipeline9PhysicalGeometryContext(srj),
  )
  expect({ srj, via }).toEqual(original)
})
