import { expect, test } from "bun:test"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getPhysicalViaRegionPortConflicts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getPhysicalViaRegionPortConflicts"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"

test("physical via regions index nearby ports independently of their layers", (): void => {
  const result = getPhysicalViaRegionPortConflicts(
    {
      portX: [0.2, 1],
      portY: [0, 0],
      regionCenterX: [0, 1],
      regionCenterY: [0, 0],
      regionWidth: [0.2032, 0.2032],
      regionHeight: [0.2032, 0.2032],
      regionMetadata: [{ isLayerTransition: true }, {}],
    },
    0.1524,
    0.1,
  )
  expect(result.portsByRegion).toEqual([[0], []])
  expect(result.regionsByPort).toEqual([[0], []])

  const params = structuredClone(input) as HgPortPointPathingSolverParams
  params.graph.regions[0]!.d.isLayerTransition = true
  params.portObstacleConstraints = {
    obstacles: [],
    traceWidth: 0.1524,
    clearance: 0.1,
  }
  const solver = new TinyHypergraphPortPointPathingSolver(params)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const native = (
    solver as unknown as { getSolvedTinySolver(): TinyHyperGraphSolver }
  ).getSolvedTinySolver()
  const viaRegion = native.topology.regionMetadata!.findIndex(
    (metadata) => metadata.isLayerTransition === true,
  )
  expect(viaRegion).toBeGreaterThanOrEqual(0)
  expect(
    native.problem.viaRegionPortConflicts!.portsByRegion[viaRegion]!.length,
  ).toBeGreaterThan(0)
})
