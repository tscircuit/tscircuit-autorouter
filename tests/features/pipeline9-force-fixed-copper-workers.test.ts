import { expect, test } from "bun:test"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { loadDdrForceClearanceFixture } from "../fixtures/loadDdrForceClearanceFixture"

test("force workers preserve completed copper clearance and serial output", async (): Promise<void> => {
  const fixture = loadDdrForceClearanceFixture()
  const regionId = "topology_merge_26131"
  const params = {
    inputSrj: fixture.inputSrj,
    hdRoutes: fixture.hdRoutes.filter((route) => route.regionId === regionId),
    nodeWithPortPoints: fixture.nodeWithPortPoints.filter(
      (node) => node.capacityMeshNodeId === regionId,
    ),
    totalStepsPerNode: 20,
    preserveTopologyPortAnchors: true,
  }
  const unchangedInput = structuredClone(params)
  const serial = new Pipeline9HighDensityForceImproveSolver(params)
  serial.solve()
  expect(serial.solved).toBeTrue()
  // This node was clear on entry; its force candidate approaches a completed via.
  expect(serial.getOutput()).toEqual(params.hdRoutes)
  const completedVia = fixture.inputSrj.obstacles.find(
    (obstacle) =>
      obstacle.shape === "circle" &&
      Math.abs(obstacle.center.x - 13.74) < 1e-9 &&
      Math.abs(obstacle.center.y - 0.55) < 1e-9,
  )!
  const remainingRoute = serial
    .getOutput()
    .find((route) => route.connectionName === "source_net_114_mst1")!
  const remainingVia = remainingRoute.vias[0]!
  const copperGap =
    Math.hypot(
      remainingVia.x - completedVia.center.x,
      remainingVia.y - completedVia.center.y,
    ) -
    (remainingRoute.viaDiameter + completedVia.width) / 2
  expect(copperGap).toBeGreaterThanOrEqual(
    fixture.inputSrj.minPadEdgeToPadEdgeClearance!,
  )
  const restored = new Pipeline9HighDensityForceImproveSolver(
    serial.getConstructorParams()[0],
  )
  restored.solve()
  expect(restored.getOutput()).toEqual(serial.getOutput())

  const runtime = createPipeline9TestRuntime(2)
  try {
    const worker = new Pipeline9HighDensityForceImproveSolver(params)
    await worker.solveAsync(runtime, 1)
    await worker.solveAsync(runtime)
    expect(worker.solved).toBeTrue()
    expect(worker.failed).toBeFalse()
    expect(worker.getOutput()).toEqual(serial.getOutput())
    expect(worker.stats).toEqual(serial.stats)
    expect(params).toEqual(unchangedInput)
  } finally {
    await runtime.dispose()
  }
})
