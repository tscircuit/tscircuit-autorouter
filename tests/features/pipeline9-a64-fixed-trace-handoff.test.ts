import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPreloadedPortValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreloadedPortValidator"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("A64 plans remaining signals without crossing the saved data copper", () => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/a64-fixed-trace-handoff.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
  )
  input.traces = input.traces!.map((trace) => ({ ...trace, isFixed: true }))
  const before = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    solverThreads: 1,
  })
  while (!solver.failed && !solver.portPointPathingSolver?.solved) {
    solver.step()
  }
  expect(solver.failed).toBeFalse()
  expect(solver.portPointPathingSolver?.solved).toBeTrue()
  expect(input).toEqual(before)

  const displacedCrossings = solver.preloadedTraceGraphSolver!
    .getOutput()
    .flatMap((segment) =>
      segment.portPoints.flatMap((port) =>
        (port._preloadedTracePortAssignments ?? []).filter(
          (assignment) =>
            assignment.isFixed &&
            Math.hypot(
              port.x - assignment.tracePoint.x,
              port.y - assignment.tracePoint.y,
            ) > 1e-6,
        ),
      ),
    )
  expect(displacedCrossings).toEqual([])

  const isClear = createPreloadedPortValidator({
    srj: input,
    connMap: getConnectivityMapFromSimpleRouteJson(input),
    traceWidth: input.minTraceWidth,
    viaDiameter: input.minViaDiameter!,
  })
  const nodes = solver.portPointPathingSolver!.getOutput().nodesWithPortPoints
  const blockedPorts = nodes.flatMap((node) =>
    node.portPoints.filter((point) => !isClear(point)),
  )
  expect(blockedPorts).toEqual([])
})
