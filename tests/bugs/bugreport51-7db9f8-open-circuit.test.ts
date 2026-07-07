import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import bugReport from "../../fixtures/bug-reports/bugreport51-7db9f8/bugreport51-7db9f8.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

// Every solved connection must reach both of its terminals. Today
// source_trace_150 (two pads 1mm apart) is emitted as a single degenerate
// route point on its start port and never reaches its end port — an open
// circuit shipped as solved=true. Root cause: RouteStitchingSolver's
// snapIslandEndpointToNearestTerminal skips terminals[0] whenever it is not
// the comparePoints-first terminal, so both island endpoints snap to the
// same terminal.
test.failing(
  "bugreport51-7db9f8 pipeline7 output reaches both terminals of every connection",
  () => {
    const solver = new AutoroutingPipelineSolver7_MultiGraph(
      structuredClone(srj),
      {
        cacheProvider: null,
      },
    )

    solver.solve()

    // Snapshot before the failing assertions so the broken render is captured
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Pipeline7 did not produce point-pair SRJ")
    }

    const traces = solver.getOutputSimplifiedPcbTraces()
    const MAX_TERMINAL_GAP = 0.5

    const openCircuits: string[] = []
    for (const connection of srjWithPointPairs.connections) {
      const routePoints = traces
        .filter((trace) => trace.connection_name === connection.name)
        .flatMap((trace) => trace.route)
      if (routePoints.length === 0) continue

      for (const terminal of connection.pointsToConnect) {
        const reachesTerminal = routePoints.some(
          (point) =>
            "x" in point &&
            "y" in point &&
            Math.hypot(point.x - terminal.x, point.y - terminal.y) <=
              MAX_TERMINAL_GAP,
        )
        if (!reachesTerminal) {
          openCircuits.push(
            `${connection.name} never reaches (${terminal.x}, ${terminal.y})`,
          )
        }
      }
    }

    expect(openCircuits).toEqual([])
  },
  { timeout: 180_000 },
)
