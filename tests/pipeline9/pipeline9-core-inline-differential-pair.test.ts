import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import srj from "../fixtures/core-inline-differential-pair.json"

test("Pipeline9 routes both sections of the three-header differential pair from core", async () => {
  const input = srj as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(
    routedTraces
      .map((trace) => [...trace.connectsTo!].sort().join("/"))
      .sort(),
  ).toEqual([
    "pcb_port_0/pcb_port_2",
    "pcb_port_1/pcb_port_3",
    "pcb_port_2/pcb_port_4",
    "pcb_port_3/pcb_port_5",
  ])

  const lengthsBySignal = new Map<string, number>()
  for (const trace of routedTraces) {
    const wires = trace.route.filter((point) => point.route_type === "wire")
    const startsAtMiddle = Math.abs(wires[0]!.x) < 1e-8
    const middleLead = startsAtMiddle ? wires[1]! : wires.at(-2)!
    const outerPad = startsAtMiddle ? wires.at(-1)! : wires[0]!
    // Each section must approach B from its own side of the header.
    expect(middleLead.x * outerPad.x).toBeGreaterThan(1e-6)

    const length = wires.slice(1).reduce((sum, point, index) => {
      const previous = wires[index]!
      return sum + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0)
    lengthsBySignal.set(
      trace.connection_name,
      (lengthsBySignal.get(trace.connection_name) ?? 0) + length,
    )
  }
  const lengths = Array.from(lengthsBySignal.values())
  expect(lengths).toHaveLength(2)
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(
    input.differentialPairs![0]!.lengthTolerance,
  )

  const drcInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
