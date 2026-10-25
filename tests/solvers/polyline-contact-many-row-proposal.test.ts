import { expect, test } from "bun:test"
import { MultiHeadPolylineContactSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolylineContactSolver"
import type { PolyLine } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("a many-row coupled contact solve makes a checked decreasing step within the unchanged QP cap", (): void => {
  const lines: PolyLine[] = []
  for (let pair = 0; pair < 12; pair++) for (const sign of [-1, 1]) {
    const y = (pair - 5.5) * 3
    lines.push({
      connectionName: `pair${pair}_${sign}`,
      start: { x: -2.5, y: y + sign * 0.5, z1: 0, z2: 0 },
      end: { x: 2.5, y: y + sign * 0.5, z1: 0, z2: 0 },
      mPoints: [-0.4, 0.4].map((x) => ({ x, y: y + sign * 0.02, z1: 0, z2: 0 })),
    })
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "many-contacts", center: { x: 0, y: 0 }, width: 6, height: 38,
    availableZ: [0, 1],
    portPoints: lines.flatMap((line) => [line.start, line.end].map((p) => ({
      x: p.x, y: p.y, z: p.z1, connectionName: line.connectionName,
    }))),
  }
  const solver = new MultiHeadPolylineContactSolver({
    nodeWithPortPoints: node, traceWidth: 0.15, viaDiameter: 0.3,
    obstacleMargin: 0.1, obstacles: [], layerCount: 2,
  })
  const terminals = lines.map((line) => [{ ...line.start }, { ...line.end }])
  solver.phase = "solving"
  solver.candidates = [{ polyLines: lines, g: 0, h: 0, f: 0, minGaps: [], viaCount: 0 }]
  while (!solver.solved && !solver.failed && Number(solver.stats.contactAcceptedSteps ?? 0) === 0)
    solver.step()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.stats.contactGeneratedRows).toBeGreaterThanOrEqual(500)
  expect(solver.stats.contactWorkCappedProposals).toBeGreaterThan(0)
  expect(solver.stats.contactAcceptedSteps).toBeGreaterThan(0)
  expect(solver.stats.contactWorkUnits).toBeLessThanOrEqual(300_000)
  expect(lines.map((line) => [line.start, line.end])).toEqual(terminals)
  expect(lines.every((line): boolean => line.mPoints.every((p): boolean => Math.abs(p.x) <= 0.7))).toBe(true)
})
