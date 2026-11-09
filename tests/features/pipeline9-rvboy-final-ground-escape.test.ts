import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy final ground escape retains free capacity beside a fixed crossing", async (): Promise<void> => {
  // Complete native phase 51: all connections, obstacles and retained copper.
  // Only the displayed viewport is cropped.
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-final-ground-escape.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 5,
    cacheProvider: null,
  })
  while (!solver.highDensityRouteSolver && !solver.failed && !solver.solved)
    solver.step()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.portPointPathingSolver!.solved).toBe(true)
  expect(solver.uniformPortDistributionSolver!.solved).toBe(true)
  const graph =
    solver.portPointPathingSolver!["tinyPipelineSolver"].inputProblem
      .serializedHyperGraph
  const crossing = graph.ports.find(
    (port) => port.portId === "ce28411_pp2_z0::0",
  )!
  expect(crossing.d!._preloadedTracePortAssignments).toHaveLength(1)
  expect(crossing.d!.clearanceAllowedNetIds).toEqual([
    crossing.d!._preloadedTracePortAssignments[0].fixedNetId,
  ])
  const neighbors = graph.ports.filter(
    (port) => port.d?.duplicatedFromPortId === crossing.portId,
  )
  expect(neighbors.length).toBeGreaterThan(0)
  expect(neighbors.every((port) => !port.d!.clearanceAllowedNetIds)).toBe(true)
  const connection = solver.srjWithPointPairs!.connections.find((connection) =>
    connection.pointsToConnect.some((point) => point.pointId === "pcb_port_43"),
  )!
  const segments = solver
    .uniformPortDistributionSolver!.getOutput()
    .map((node) =>
      node.portPoints.filter(
        (point) => point.connectionName === connection.name,
      ),
    )
    .filter((points) => points.length > 0)
  expect(segments.length).toBeGreaterThan(1)
  expect(input.traces).toHaveLength(109)
  expect(input.obstacles).toHaveLength(1022)
  expect(JSON.stringify(input)).toBe(original)
  for (const state of ["before", "after"] as const) {
    const graphics = convertSrjToGraphicsObject({ ...input, connections: [] })
    graphics.points = []
    for (const point of connection.pointsToConnect)
      graphics.circles!.push({
        center: point,
        radius: 0.12,
        fill: "white",
        stroke: state === "before" ? "#d21b27" : "#087f23",
      })
    // Planned graph segments after spacing, not final manufactured copper.
    if (state === "after")
      for (const points of segments)
        graphics.lines!.push({
          points,
          strokeColor: "#087f23",
          strokeWidth: 0.1,
        })
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: -35, maxX: -32.8, minY: -32.7, maxY: -31.1 },
        "RVboy final phase: VSEL ground escape",
        state === "before"
          ? "Before: fixed-port ownership removes neighboring demand slots"
          : "After: green planned escape; fixed crossing stays reserved for its net",
      ).replace(/[ \t]+$/gm, ""),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
