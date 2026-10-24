import { expect, test } from "bun:test"
import { createMeshCorridorSearch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createMeshCorridorSearch"
import { createMeshInput } from "../fixtures/constrained-corridor-mesh-fixture"

test("construction and actual heap budgets report distinct unknowns without selecting the old graph", (): void => {
  for (const cap of ["points", "work", "nodes"] as const) {
    const input = createMeshInput()
    if (cap === "points") input.maxMeshPoints = 4
    if (cap === "work") input.maxMeshConstructionWork = 1
    if (cap === "nodes") input.maxNodes = 1
    const stats = { nodesPopped: 0, completionReason: "no-path" as const }
    let edges = 0
    const search = createMeshCorridorSearch({ input, barriers: [], clear: (): boolean => { edges++; return true }, extraCost: (): number => 0, clearsDrills: (): boolean => true, stats })
    let result = search.step()
    while (result.status === "pending") result = search.step()
    expect(result.path).toBeNull()
    expect(result.reason).toBe(cap === "nodes" ? "node-limit" : "geometry-limit")
    expect(stats.nodesPopped).toBe(cap === "nodes" ? 1 : 0)
    if (cap !== "nodes") expect(edges).toBe(0)
  }
  const bad = createMeshInput()
  bad.bounds.maxX = Number.NaN
  expect(() => createMeshCorridorSearch({ input: bad, barriers: [], clear: (): boolean => true, extraCost: (): number => 0, clearsDrills: (): boolean => true, stats: { nodesPopped: 0, completionReason: "no-path" } })).toThrow()
})
