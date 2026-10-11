import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { captureParallelPathPrototypeContract, createParallelPathLookaheadEligibility } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelPathLookaheadEligibility"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("same-capture shared input validation is renewed after await and before every new capture without observing changed metadata", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const metadata = { value: 17, nested: { id: "shared" } }
  const routes: HighDensityRoute[] = Array.from({ length: 6 }, (_, index) => ({ connectionName: `scope-${index}`,
    traceThickness: 0.15, viaDiameter: 0.3, vias: [], route: [{ x: -2, y: index * 0.4, z: 0, metadata },
      { x: 0, y: index * 0.4 + 0.2, z: 0 }, { x: 2, y: index * 0.4, z: 0 }] }))
  routes[1]!.route[0] = routes[0]!.route[0]!
  const owner = new MultiSimplifiedPathSolver({ unsimplifiedHdRoutes: routes, obstacles: [] })
  const helper = createParallelPathLookaheadEligibility(owner, captureParallelPathPrototypeContract(MultiSimplifiedPathSolver.prototype))!
  expect(helper()).toBe(true)
  const scope = helper.captureScope([0, 1])!
  expect(scope()).toBe(true)
  const awaiting = helper.captureAwaitState(scope)!
  expect(awaiting()).toBe(true)
  let observations = 0
  const metadataDescriptor = Object.getOwnPropertyDescriptor(metadata, "value")!
  Object.defineProperty(metadata, "value", { enumerable: true, configurable: true, get(): never {
    observations++
    throw new RangeError("late shared metadata observer")
  } })
  expect(scope()).toBe(false)
  expect(awaiting()).toBe(false)
  expect(helper.captureScope([0, 1])).toBeUndefined()
  expect(observations).toBe(0)
  Object.defineProperty(metadata, "value", metadataDescriptor)
  expect(scope()).toBe(true)
  expect(awaiting()).toBe(true)
  const point = routes[0]!.route[0]!
  const pointDescriptor = Object.getOwnPropertyDescriptor(point, "x")!
  await Promise.resolve()
  point.x += 0.01
  expect(scope()).toBe(false)
  expect(awaiting()).toBe(false)
  expect(helper.captureScope([0, 1])).toBeUndefined()
  Object.defineProperty(point, "x", pointDescriptor)
  expect(scope()).toBe(true)
  expect(awaiting()).toBe(true)
  expect(helper.captureScope([0, 1])!()).toBe(true)
  expect(observations).toBe(0)
})
