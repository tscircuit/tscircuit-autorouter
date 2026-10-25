import { expect, test } from "bun:test"
import { MultiHeadPolylineContactSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolylineContactSolver"
import type { Candidate } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("a conservative obstacle envelope cannot reject an exactly validated physical route", (): void => {
  const { solver: original, node } = createPolylineContactFixture()
  const solver = new MultiHeadPolylineContactSolver({
    ...original.physicalContext,
    nodeWithPortPoints: { ...node, portPoints: node.portPoints.filter((p): boolean => p.connectionName === "a")
      .map((p) => ({ ...p, y: 0.3 })) },
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: [] }],
  })
  const candidate: Candidate = { g: 0, h: 0, f: 0, viaCount: 0, minGaps: [], polyLines: [{
    connectionName: "a", start: { x: -2.5, y: 0.3, z1: 0, z2: 0 },
    end: { x: 2.5, y: 0.3, z1: 0, z2: 0 }, mPoints: [{ x: 0, y: 0.3, z1: 0, z2: 0 }],
  }] }
  solver.phase = "solving"
  solver.candidates = [candidate]
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(solver.stats.contactActivePairs).toBeGreaterThan(0)
  expect(Number(solver.stats.contactQpRounds ?? 0)).toBe(0)
  expect(candidate.polyLines[0]!.mPoints[0]!.y).toBe(0.3)
})
