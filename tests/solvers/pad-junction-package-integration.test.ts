import { expect, test } from "bun:test"
import { PadJunctionSimplificationSolver } from "@tscircuit/pad-junction-simplifier"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PadJunctionSimplificationSolver as PublicPadSolver } from "lib/index"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("trace simplification uses and re-exports the standalone pad junction solver", () => {
  expect(PublicPadSolver).toBe(PadJunctionSimplificationSolver)
  const hdRoutes: HighDensityRoute[] = [-2, 2].map((x, index) => ({
    connectionName: `branch${index}`,
    traceThickness: 0.2,
    viaDiameter: 0.3,
    route: [
      { x, y: 4, z: 0 },
      { x: 0, y: 0, z: 0, pcb_port_id: "target" },
    ],
    vias: [],
  }))
  const solver = new TraceSimplificationSolver({
    hdRoutes,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layers: ["top"],
        connectedTo: ["target"],
      },
    ],
    connMap: new ConnectivityMap({ signal: ["branch0", "branch1", "target"] }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  })
  // Enter the final phase to exercise the package handoff without earlier cleanup.
  solver.simplificationPipelineLoops =
    solver.MAX_SIMPLIFICATION_PIPELINE_LOOPS - 1
  solver.currentPhase = "pad_junction_simplification"
  solver.step()
  const padSolver = solver.activeSubSolver
  expect(padSolver).toBeInstanceOf(PadJunctionSimplificationSolver)
  solver.solve()
  expect(solver.solved).toBe(true)
  if (!(padSolver instanceof PadJunctionSimplificationSolver))
    throw new Error("Expected standalone pad solver")
  expect(padSolver.outcomes[0]?.outcome).toBe("accepted")
  expect(solver.simplifiedHdRoutes).toEqual(padSolver.getOutput())
  expect(solver.simplifiedHdRoutes[0]!.route.at(-1)).toEqual(
    hdRoutes[0]!.route.at(-1),
  )
})
