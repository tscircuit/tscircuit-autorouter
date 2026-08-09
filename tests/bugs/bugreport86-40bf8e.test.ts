import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = structuredClone(bugReport.simple_route_json) as SimpleRouteJson
// This report predates opaque SRJ metadata. Its producer placed the obstacle's
// own identity first in connectedTo and repeated it immediately before the
// associated port identity. Migrate that historical structure without parsing
// either ID. Current Core emits this metadata directly. Pipeline9 ignores it;
// only the DRC adapter carries it back onto reconstructed Circuit JSON entities.
for (const obstacle of srj.obstacles) {
  const elementId = obstacle.connectedTo[0]
  if (!elementId) continue
  const repeatedElementIndex = obstacle.connectedTo.indexOf(elementId, 1)
  if (repeatedElementIndex === -1) continue
  const pcbPortId = obstacle.connectedTo[repeatedElementIndex + 1]

  obstacle.metadata =
    obstacle.layers.length > 1
      ? { pcb_plated_hole_id: elementId, pcb_port_id: pcbPortId }
      : { pcb_smtpad_id: elementId, pcb_port_id: pcbPortId }
}

test("Pipeline9 routes LCD traces around the 76 preloaded traces in bugreport86-40bf8e", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    {
      cacheProvider: null,
      effort: 1,
    },
  )

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
