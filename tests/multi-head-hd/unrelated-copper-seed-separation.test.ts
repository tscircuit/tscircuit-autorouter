import { expect, test } from "bun:test"
import { doSegmentsIntersect } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { computeViaCountVariants } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/computeViaCountVariants"
import { detectMultiConnectionClosedFacesWithoutVias } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/detectMultiConnectionClosedFacesWithoutVias"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { ViaPossibilitiesSolver2 } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("unrelated crossing routes retain layer separation and copper rejection", (): void => {
  const connMap = new ConnectivityMap({ signalA: ["a"], signalB: ["b"] })
  const lines: PolyLine2[] = [
    {
      connectionName: "a",
      start: { x: -3, y: -3, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: 0, z1: 0, z2: 0 }],
      end: { x: 3, y: 3, z1: 0, z2: 0 },
    },
    {
      connectionName: "b",
      start: { x: -3, y: 3, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: 0, z1: 0, z2: 0 }],
      end: { x: 3, y: -3, z1: 0, z2: 0 },
    },
  ]
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "unrelated-crossing",
    center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
    portPoints: lines.flatMap((line) => [
      { ...line.start, z: 0, connectionName: line.connectionName },
      { ...line.end, z: 0, connectionName: line.connectionName },
    ]),
  }
  const entries: [string, { start: PolyLine2["start"]; end: PolyLine2["end"] }][] = lines.map((line) => [line.connectionName, line])
  for (const map of [connMap, undefined]) {
    const variants = computeViaCountVariants(entries, 2, 2, 0, map)
    expect(variants).not.toContainEqual([0, 0])
    expect(variants).toContainEqual([2, 0])
    expect(variants).toContainEqual([0, 2])
    const solver = new MultiHeadPolyLineIntraNodeSolver({ nodeWithPortPoints, connMap: map })
    expect(solver.checkIfSolved({ polyLines: lines, minGaps: solver.computeMinGapBtwPolyLines(lines) })).toBe(false)
    expect(detectMultiConnectionClosedFacesWithoutVias(lines, solver.bounds, map)).toBe(true)
    const seeds = new ViaPossibilitiesSolver2({ nodeWithPortPoints, connMap: map })
    seeds.solve()
    expect(seeds.solved).toBe(true)
    const paths = [...seeds.completedPaths.values()]
    const transitions = paths.flatMap((path) => path.slice(1).filter((point, i) => point.z !== path[i]!.z))
    expect(transitions).toHaveLength(2)
    for (let i = 0; i < paths[0]!.length - 1; i++) {
      for (let j = 0; j < paths[1]!.length - 1; j++) {
        const a = paths[0]![i]!, b = paths[0]![i + 1]!
        const c = paths[1]![j]!, d = paths[1]![j + 1]!
        if (a.z !== b.z || c.z !== d.z || a.z !== c.z) continue
        expect(doSegmentsIntersect(a, b, c, d)).toBe(false)
      }
    }
  }
})
