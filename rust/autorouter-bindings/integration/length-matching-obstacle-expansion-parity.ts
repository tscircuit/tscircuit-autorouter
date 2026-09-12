import assert from "node:assert/strict"
import { PostProcessingSolver, type PostProcessingSolverParams } from "@tscircuit/length-matching-solver"
import { createPostProcessingModel } from "../../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/binding/createPostProcessingModel"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { expandPostProcessingObstacleConnectedIds } from "../../../lib/bindings/expandPostProcessingObstacleConnectedIds"
import { importReference } from "./tsReference"

const { PostProcessingSolver: ReferenceSolver } = await importReference<{ PostProcessingSolver: typeof PostProcessingSolver }>("node_modules/@tscircuit/length-matching-solver/lib/PostProcessingSolver.ts")
const { createPostProcessingModel: referenceModel } = await importReference<{ createPostProcessingModel: typeof createPostProcessingModel }>("node_modules/@tscircuit/length-matching-solver/lib/post-processing/binding/createPostProcessingModel.ts")
const { createPostProcessingTestParams } = await importReference<{ createPostProcessingTestParams: (options: { routingGrid: { innerGridStep: number } }) => PostProcessingSolverParams }>("node_modules/@tscircuit/length-matching-solver/tests/post-processing/createPostProcessingTestParams.ts")

const aliases = [["a", "b"], ["b", "c", "c"], ["c", "\ud800", "\u0000"], ["constructor", "__proto__"]]
const ids = [["a", "a"], ["untouched", "untouched"], ["constructor"], ["\ud800"]]
const expectedIds = structuredClone(ids)
const changed = ids.map(() => false)
for (const names of aliases) {
  const set = new Set(names)
  expectedIds.forEach((connected, index) => {
    if (!connected.some((name) => set.has(name))) return
    changed[index] = true
    expectedIds[index] = [...new Set([...connected, ...set])]
  })
}
assert.deepEqual(expandPostProcessingObstacleConnectedIds(aliases, ids), expectedIds.map((names, index) => changed[index] ? names : null))

for (const label of ["straight", "aliases", "invalid-grid"] as const) {
  const params = createPostProcessingTestParams({ routingGrid: { innerGridStep: 0.5 } })
  if (label === "aliases") {
    params.hdRoutes[0]!.rootConnectionName = "root"
    params.hdRoutes[0]!.route[0]!.pcb_port_id = "port"
    params.hdRoutes.push({ ...structuredClone(params.hdRoutes[0]!), connectionName: "next", rootConnectionName: "root" })
    const shared = ["P", "P"]
    for (const connectedTo of [shared, shared, ["unmatched", "unmatched"], ["port"]]) {
      params.obstacles.push({ type: "rect", layers: ["top"], center: { x: -1.5, y: 4 }, width: 0.1, height: 0.1, connectedTo })
    }
  }
  if (label === "invalid-grid") params.routingGrid = { innerGridStep: 0 }
  const original = structuredClone(params)
  let calls = 0
  const actualModel = createPostProcessingModel(params, (routeAliases, obstacleIds) => {
    calls++
    return expandPostProcessingObstacleConnectedIds(routeAliases, obstacleIds)
  })
  const expectedModel = referenceModel(params)
  assert.deepEqual(actualModel, expectedModel, `${label}: full model`)
  const arrayAliases = (model: typeof actualModel): boolean[][] => model.params.simpleRouteJson.obstacles.map((left) => model.params.simpleRouteJson.obstacles.map((right) => left.connectedTo === right.connectedTo))
  assert.deepEqual(arrayAliases(actualModel), arrayAliases(expectedModel), `${label}: obstacle aliases`)
  const construct = (reference: boolean): PostProcessingSolver | Error => {
    try {
      return reference ? new ReferenceSolver(structuredClone(params)) : new PostProcessingSolver(structuredClone(params), (a, b) => {
        calls++
        return expandPostProcessingObstacleConnectedIds(a, b)
      })
    } catch (error) {
      assert.ok(error instanceof Error)
      return error
    }
  }
  const actual = construct(false), expected = construct(true)
  if (actual instanceof Error || expected instanceof Error) {
    assert.ok(actual instanceof Error && expected instanceof Error)
    assert.equal(actual.name, expected.name)
    assert.equal(actual.message, expected.message)
  } else {
    let steps = 0
    const state = (solver: PostProcessingSolver): unknown => ({ solved: solver.solved, failed: solver.failed, iterations: solver.iterations, error: solver.error, progress: solver.progress, MAX_ITERATIONS: solver.MAX_ITERATIONS })
    while (!actual.solved && !actual.failed) {
      actual.step()
      expected.step()
      assert.deepEqual(state(actual), state(expected), `${label}: step ${steps}`)
      if (++steps > 100000) throw new Error("Parity fixture exceeded step budget")
    }
    assert.deepEqual(actual.getOutput(), expected.getOutput(), `${label}: output`)
    const graphics = actual.finalVisualize(), expectedGraphics = expected.finalVisualize()
    assert.deepEqual(graphics, expectedGraphics, `${label}: final graphics`)
    assert.equal(getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }), getSvgFromGraphicsObject(expectedGraphics, { backgroundColor: "white" }), `${label}: final SVG`)
    assert.ok(calls >= (label === "invalid-grid" ? 2 : 3), `${label}: model construction uses native hook`)
    console.log(`${label}: ${steps} steps, output, final graphics and SVG exact`)
  }
  assert.deepEqual(params, original, `${label}: input unchanged`)
}
console.log("Length-matching expansion: ordered aliases, lossless strings, full model, steps, output, errors and final visuals match frozen TS")
