import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { stackSvgsVertically } from "stack-svgs"
import { AutoroutingPipelineSolver } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import repro from "../../fixtures/bug-reports/subcircuit-then-parent-route-failure/subcircuit-then-parent-route-failure.json" with {
  type: "json",
}

type ParentTraceMetadata = Pick<
  SimplifiedPcbTrace,
  "connection_name" | "connectsTo"
>

test.failing(
  "a parent routes after its child subcircuit without breakout points",
  () => {
    const childSolver = new AutoroutingPipelineSolver(
      structuredClone(repro.child_simple_route_json) as SimpleRouteJson,
    )
    childSolver.solve()

    expect(childSolver.failed).toBe(false)
    expect(childSolver.solved).toBe(true)
    if (!childSolver.srjWithPointPairs) {
      throw new Error("Child subcircuit did not produce point-pair SRJ")
    }

    const childDrc = evaluateRelaxedDrc({
      inputSrj: repro.child_simple_route_json as SimpleRouteJson,
      srjWithPointPairs: childSolver.srjWithPointPairs,
      routedTraces: childSolver.getOutputSimplifiedPcbTraces(),
    })
    expect(childDrc.errors).toEqual([])

    const parentTraceMetadata = repro.parent_preloaded_trace_metadata as Record<
      string,
      ParentTraceMetadata
    >
    const childTraces = childSolver.getOutputSimplifiedPcbTraces()
    const missingTraceMetadata = childTraces
      .map((trace) => trace.pcb_trace_id)
      .filter((traceId) => !parentTraceMetadata[traceId])

    expect(missingTraceMetadata).toEqual([])

    const parentSrj = structuredClone(
      repro.parent_simple_route_json,
    ) as SimpleRouteJson
    parentSrj.traces = childTraces.map((trace) => ({
      ...trace,
      ...parentTraceMetadata[trace.pcb_trace_id],
    }))

    const parentSolver = new AutoroutingPipelineSolver(parentSrj)
    parentSolver.solve()

    const childOutputSrj: SimpleRouteJson = {
      ...(repro.child_simple_route_json as SimpleRouteJson),
      traces: childTraces,
    }
    expect(
      stackSvgsVertically([
        getSvgFromGraphicsObject(convertSrjToGraphicsObject(childOutputSrj), {
          backgroundColor: "white",
        }),
        getSvgFromGraphicsObject(convertSrjToGraphicsObject(parentSrj), {
          backgroundColor: "white",
        }),
      ]),
    ).toMatchSvgSnapshot(import.meta.path)
    expect(parentSolver.failed).toBe(false)
    expect(parentSolver.solved).toBe(true)
  },
)
