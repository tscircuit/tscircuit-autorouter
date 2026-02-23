import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline3 } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"

test("should solve e2e3 single-layer with 0603 jumpers available", async () => {
  const simpleSrj: SimpleRouteJson = {
    ...(e2e3Fixture as SimpleRouteJson),
    layerCount: 1,
    availableJumperTypes: ["0603"],
  }

  const solver = new AssignableAutoroutingPipeline3(simpleSrj)
  solver.solve()

  expect(solver.solved).toBe(true)

  const nodesWithCrossings = solver.highDensitySolver?.nodesWithCrossings ?? []
  const nodesWithoutCrossings =
    solver.highDensitySolver?.nodesWithoutCrossings ?? []
  console.log(`Nodes with crossings: ${nodesWithCrossings.length}`)
  console.log(`Nodes without crossings: ${nodesWithoutCrossings.length}`)

  const result = solver.getOutputSimpleRouteJson()

  const jumpers = result.jumpers ?? []
  console.log(`Number of 0603 jumpers added: ${jumpers.length}`)

  // Verify jumper structure if any were added
  for (const jumper of jumpers) {
    expect(jumper.jumper_footprint).toBe("0603")
    expect(jumper.center).toBeDefined()
    expect(jumper.orientation).toMatch(/^(horizontal|vertical)$/)
    expect(jumper.pads).toBeDefined()
    expect(jumper.pads.length).toBeGreaterThan(0)
  }

  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )
}, 60_000)
