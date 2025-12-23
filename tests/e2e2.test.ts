import { expect, test, describe } from "bun:test"
import { CapacityMeshSolver } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import e2e8 from "examples/legacy/assets/e2e8.json"
import { getLastStepSvg } from "./fixtures/getLastStepSvg"

describe.skip("CapacityMeshSolver", () => {
  test("getOutputSimpleRouteJson throws when solver is not complete", () => {
    const simpleSrj = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    }

    const solver = new CapacityMeshSolver(simpleSrj)

    solver.solve()

    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  })
})
