import { expect, test, describe } from "bun:test"
import { CapacityMeshSolver } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import e2e8 from "examples/legacy/assets/e2e8.json"

describe("CapacityMeshSolver", () => {
  test("getOutputSimpleRouteJson throws when solver is not complete", () => {
    const simpleSrj = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [],
      connections: [],
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    }

    const solver = new CapacityMeshSolver(simpleSrj)

    expect(() => solver.getOutputSimpleRouteJson()).toThrow(
      "Cannot get output before solving is complete",
    )
  })

  test("should solve with obstacles and connections", async () => {
    const simpleSrj: SimpleRouteJson = e2e8 as any

    const solver = new CapacityMeshSolver(simpleSrj)
    await solver.solve()

    const result = solver.getOutputSimpleRouteJson()
    expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
      import.meta.path,
    )
  })
})
