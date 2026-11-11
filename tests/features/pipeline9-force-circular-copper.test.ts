import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { loadDdrForceClearanceFixture } from "../fixtures/loadDdrForceClearanceFixture"

test("force improvement measures circular copper without square corners", (): void => {
  const fixture = loadDdrForceClearanceFixture()
  const regionId = "topology_merge_26131"
  const completedVia = {
    type: "rect" as const,
    shape: "circle" as const,
    center: { x: 13.41, y: 0.62 },
    width: 0.28,
    height: 0.28,
    layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
    connectedTo: ["completed_byte"],
  }
  const params = {
    inputSrj: { ...fixture.inputSrj, obstacles: [completedVia] },
    hdRoutes: fixture.hdRoutes.filter((route) => route.regionId === regionId),
    nodeWithPortPoints: fixture.nodeWithPortPoints.filter(
      (node) => node.capacityMeshNodeId === regionId,
    ),
    totalStepsPerNode: 20,
    preserveTopologyPortAnchors: true,
  }
  const proposal = new HighDensityForceImproveSolver(params)
  proposal.solve()
  const movingRoute = proposal
    .getOutput()
    .find((route) => route.connectionName === "source_net_114_mst1")!
  const movingVia = movingRoute.vias[0]!
  const copperGap =
    Math.hypot(
      movingVia.x - completedVia.center.x,
      movingVia.y - completedVia.center.y,
    ) -
    (movingRoute.viaDiameter + completedVia.width) / 2
  expect(copperGap).toBeGreaterThanOrEqual(0.1)

  const solver = new Pipeline9HighDensityForceImproveSolver(params)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()).toEqual(proposal.getOutput())
})
