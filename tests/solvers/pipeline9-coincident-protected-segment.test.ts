import { expect, test } from "bun:test"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import { normalizeCoincidentRoutePoints } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizeCoincidentRoutePoints"
import { Pipeline9TraceSimplificationSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9TraceSimplificationSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

test("duplicate coordinate cleanup keeps the outgoing plated-hole edge and terminal witness across simplification phases", (): void => {
  const input: HighDensityRoute = {
    connectionName: "net", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "pad" },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "hole" } },
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 1, z: 1 },
    ],
  }
  const frozen = structuredClone(input)
  const cleaned = normalizeCoincidentRoutePoints(input)
  expect(cleaned.route).toHaveLength(3)
  expect(cleaned.route[0].pcb_port_id).toBe("pad")
  expect(cleaned.route[0].toNextSegmentType).toBe("through_obstacle")
  expect(cleaned.route[0].toNextSegmentCircuitJsonMetadata?.pcb_plated_hole_id).toBe("hole")
  expect(cleaned.vias).toHaveLength(0)
  expect(input).toEqual(frozen)
  const cleared = normalizeCoincidentRoutePoints({ ...input, route: [input.route[2], { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }] })
  expect(cleared.route[0].toNextSegmentType).toBeUndefined()
  const solver = new Pipeline9TraceSimplificationSolver({ hdRoutes: [input], obstacles: [{ type: "rect", center: { x: 0.5, y: 0.5 }, width: 1.2, height: 1.2, layers: ["top", "bottom"], connectedTo: ["net"], circuitJsonMetadata: { pcb_plated_hole_id: "hole" } }], connMap: new ConnectivityMap({ net: ["net"] }), colorMap: {}, defaultViaDiameter: 0.3, layerCount: 2, enableCrossingViaReduction: true })
  solver._step()
  // Inject a native phase result with duplicates, then let the real phase
  // transition construct CrossingViaReductionSolver from the extracted route.
  const subSolver = solver.activeSubSolver!
  subSolver.step = (): void => { subSolver.solved = true }
  // The normalizer wraps the callback when the sub-solver is created. The
  // callback itself reads this public result from the actual via-removal solver.
  Object.assign(subSolver, { getOptimizedHdRoutes: (): HighDensityRoute[] => [input] })
  solver._step()
  expect(solver.currentPhase).toBe("crossing_via_reduction")
  expect(solver.hdRoutes[0].route).toHaveLength(3)
  expect(solver.hdRoutes[0].route[0].toNextSegmentCircuitJsonMetadata?.pcb_plated_hole_id).toBe("hole")
  expect(() => normalizeCoincidentRoutePoints({ ...input, route: [input.route[0], { ...input.route[0], pcb_port_id: "other" }] })).toThrow("conflicting terminal")
})
