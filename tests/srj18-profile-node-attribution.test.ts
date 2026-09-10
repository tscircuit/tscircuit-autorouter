import { expect, test } from "bun:test"
import { attributeNodeWrappers } from "../scripts/srj18Profile/attributeNodeWrappers"
import type { SolverRecord } from "../scripts/srj18Profile/reportTypes"

test("node attribution fills single-node wrappers without mislabeling multi-node wrappers or mutating raw records", () => {
  const record = (id: number, parentId: number | null, solver: string, nodeId: string | null): SolverRecord => ({
    id, parentId, solver, nodeId, stage: "highDensityRouteSolver", inclusiveMs: 0, winningSolverId: null,
  })
  const raw = [
    record(1, null, "Pipeline", null),
    record(2, 1, "Pipeline9RegionalFallbackSolver", null),
    record(3, 2, "HighDensitySolver", null),
    record(4, 3, "GrowShrinkHighDensityIntraNodeSolver", "cmn_4"),
    record(5, 2, "RepairSolver", null),
    record(6, 1, "HighDensitySolver", null),
    record(7, 6, "GrowShrinkHighDensityIntraNodeSolver", "cmn_7"),
    record(8, 6, "GrowShrinkHighDensityIntraNodeSolver", "cmn_8"),
  ]
  const rows = attributeNodeWrappers(raw)
  expect(rows[1]!.nodeId).toBe("cmn_4")
  expect(rows[2]!.nodeAttribution).toBe("single_node_wrapper_descendant")
  expect(rows[4]!.nodeId).toBe("cmn_4")
  expect(rows[4]!.nodeAttribution).toBe("wrapper_ancestor")
  expect(rows[0]!.nodeId).toBeNull()
  expect(rows[5]!.nodeId).toBeNull()
  expect(raw[1]!.nodeId).toBeNull()
})
