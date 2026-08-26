import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import capturedArduinoRegionReroute from "./assets/pipeline9-arduino-region-reroute.srj.json" with {
  type: "json",
}

const EXPECTED_OUTPUT_TRACES_SHA256 =
  "9e033c09c881bf806770a7b83585dbfcc6e8569cf3357c4e09f5b276b5df8b67"

const VISUAL_BOUNDS = {
  minX: 11.5,
  maxX: 16,
  minY: 7.5,
  maxY: 18.5,
}

test("Pipeline9 recognizes same-net Arduino region boundary contacts", async () => {
  const input = structuredClone(
    capturedArduinoRegionReroute,
  ) as unknown as SimpleRouteJson
  expect(input.connections).toHaveLength(4)
  expect(input.obstacles).toHaveLength(343)
  expect(input.traces).toHaveLength(210)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  const outputTraces = output.traces ?? []
  expect(outputTraces).toHaveLength(214)
  expect(
    createHash("sha256").update(JSON.stringify(outputTraces)).digest("hex"),
  ).toBe(EXPECTED_OUTPUT_TRACES_SHA256)

  // The reproduction branch recorded 61 full reference validations because
  // the eight intentional same-net boundary joins were reported as
  // disconnected. Proving their physical contact avoids entering exact repair.
  const jointDrcStats = solver.pipeline9JointDrcRepairSolver?.stats
  expect(jointDrcStats).toMatchObject({
    initialJointDrcIssueCount: 0,
    referenceDrcValidationCount: 0,
    referenceDrcFalseNegativeCount: 0,
  })
  expect(
    solver.pipeline9JointDrcRepairSolver?.exactRepairSolver,
  ).toBeUndefined()

  const inputTraceIds = new Set(
    (input.traces ?? []).map((trace) => trace.pcb_trace_id),
  )
  const reroutedTraces = outputTraces.filter(
    (trace) => !inputTraceIds.has(trace.pcb_trace_id),
  )
  const rerouteEndpointKeys = new Set(
    input.connections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => `${point.x},${point.y}`),
    ),
  )
  const boundaryTraces = (input.traces ?? []).filter((trace) =>
    trace.route.some(
      (routePoint) =>
        "x" in routePoint &&
        rerouteEndpointKeys.has(`${routePoint.x},${routePoint.y}`),
    ),
  )
  expect(reroutedTraces).toHaveLength(4)
  expect(boundaryTraces).toHaveLength(8)
  expect(
    boundaryTraces.every((trace) => {
      const [start, end] = trace.route
      return (
        trace.route.length === 2 &&
        start?.route_type === "wire" &&
        end?.route_type === "wire" &&
        start.x >= VISUAL_BOUNDS.minX &&
        start.x <= VISUAL_BOUNDS.maxX &&
        start.x === end.x
      )
    }),
  ).toBe(true)
  const representedEndpointKeys = boundaryTraces.flatMap((trace) =>
    trace.route.flatMap((routePoint) => {
      if (!("x" in routePoint)) return []
      const endpointKey = `${routePoint.x},${routePoint.y}`
      return rerouteEndpointKeys.has(endpointKey) ? [endpointKey] : []
    }),
  )
  expect(representedEndpointKeys.sort()).toEqual(
    [...rerouteEndpointKeys].sort(),
  )

  const clippedBoundaryTraces = boundaryTraces.map((trace) => ({
    ...trace,
    route: trace.route.map((routePoint) => {
      if (routePoint.route_type !== "wire") {
        throw new Error(
          `Expected boundary trace "${trace.pcb_trace_id}" to contain only wire points`,
        )
      }
      return {
        ...routePoint,
        y: Math.max(
          VISUAL_BOUNDS.minY,
          Math.min(VISUAL_BOUNDS.maxY, routePoint.y),
        ),
      }
    }),
  }))
  const visualObstacles = input.obstacles.filter(
    (obstacle) =>
      obstacle.center.x + obstacle.width / 2 >= VISUAL_BOUNDS.minX &&
      obstacle.center.x - obstacle.width / 2 <= VISUAL_BOUNDS.maxX &&
      obstacle.center.y + obstacle.height / 2 >= VISUAL_BOUNDS.minY &&
      obstacle.center.y - obstacle.height / 2 <= VISUAL_BOUNDS.maxY,
  )
  expect(visualObstacles).toHaveLength(8)

  const visualSrj: SimpleRouteJson = {
    ...output,
    bounds: VISUAL_BOUNDS,
    connections: input.connections.map((connection) => {
      const [rootConnectionName] = connection.__rootConnectionNames ?? []
      if (!rootConnectionName) {
        throw new Error(
          `Expected reroute connection "${connection.name}" to name its root connection`,
        )
      }
      return { ...connection, name: rootConnectionName }
    }),
    obstacles: visualObstacles,
    traces: [...clippedBoundaryTraces, ...reroutedTraces],
  }
  const regionGraphics = convertSrjToGraphicsObject(visualSrj, {
    traceColorMode: "net",
  })
  regionGraphics.rects = [
    ...(regionGraphics.rects ?? []),
    {
      center: {
        x: (VISUAL_BOUNDS.minX + VISUAL_BOUNDS.maxX) / 2,
        y: (VISUAL_BOUNDS.minY + VISUAL_BOUNDS.maxY) / 2,
      },
      width: VISUAL_BOUNDS.maxX - VISUAL_BOUNDS.minX,
      height: VISUAL_BOUNDS.maxY - VISUAL_BOUNDS.minY,
      fill: "none",
      stroke: "#94a3b8",
      label: "Arduino reroute region",
    },
  ]
  const regionSvg = getSvgFromGraphicsObject(regionGraphics, {
    backgroundColor: "white",
    svgWidth: 360,
    svgHeight: 640,
  })
  await expect(regionSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "routed-region",
    tolerance: 0,
  })
})
