import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { getRouteObstacleClearance } from "high-density-repair02/lib/high-density-repair-solver/functions/repairNodeClearance"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("actual Net13 node repair retains inner5 obstacles and physical stack context through workers", async (): Promise<void> => {
  const parameters = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/net13-inner5-repair-context.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0]
  const original = structuredClone(parameters)
  const serial = new Pipeline4HighDensityRepairSolver(parameters)
  const sample = serial.sampleEntries[0]!.sample
  expect(parameters.nodeWithPortPoints[0]!.availableZ).toEqual([0])
  expect(sample.layerCount).toBe(8)
  expect(sample.allowBlindAndBuriedVias).toBe(false)
  const obstacle = sample.clearanceObstacles!.find((obstacle) =>
    obstacle.zLayers!.includes(5),
  )!
  expect(obstacle).toBeDefined()
  expect(obstacle.connectedTo).toEqual([])
  const route = sample.nodeHdRoutes!.find(
    (route) => route.connectionName === "source_net_altium_pcb_13",
  )!
  expect(getRouteObstacleClearance(route, obstacle)).toBe(Infinity)
  expect(getRouteObstacleClearance(route, obstacle, sample)).toBeLessThan(0)
  expect(structuredClone(sample)).toEqual(sample)
  expect(serial.getConstructorParams()[0].layerCount).toBe(8)
  serial.solve()
  expect(serial.failed).toBe(false)
  expect(serial.stats.nodeClearanceInitialConflictCount).toBeGreaterThan(0)
  const runtime = createPipeline9TestRuntime(1)
  try {
    const worker = new Pipeline4HighDensityRepairSolver(
      structuredClone(original),
    )
    await worker.solveAsync(runtime)
    expect(worker.solved).toBe(true)
    expect(worker.getOutput()).toEqual(serial.getOutput())
    expect(worker.stats).toEqual(serial.stats)
    expect(worker.iterations).toBe(serial.iterations)
    expect(structuredClone(worker.getOutput())).toEqual(worker.getOutput())
  } finally {
    await runtime.dispose()
  }
  expect(parameters).toEqual(original)
})
