import { expect, test } from "bun:test"
import { PathPackingGeometry, createPathPackingAudit } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import { selectPackedPaths } from "lib/solvers/HighDensitySolver/selectPackedPaths"
import { finishPackingGenerator, packingChoice } from "./fixtures/pathPackingSynthetic"

test("simultaneous geometric choices solve a cyclic bank that every greedy route ordering misses", () => {
  const banks = [
    [packingChoice("a", 1, 4, [0, 8]), packingChoice("a", 1, 4, [2])],
    [packingChoice("b", 2, 7, [2, 4]), packingChoice("b", 2, 7, [0, 6])],
    [packingChoice("c", 3, 10, [6, 8]), packingChoice("c", 3, 10, [4])],
  ]
  const audit = createPathPackingAudit()
  const geometry = new PathPackingGeometry({ node: { capacityMeshNodeId: "cyclic", center: { x: 5, y: 5 },
    width: 20, height: 22, availableZ: [0, 1, 2, 3], portPoints: [] }, obstacles: [], layerCount: 4,
    allowBlindAndBuriedVias: true, traceClearance: 0.05, viaToPadClearance: 0.05,
    holeClearance: 0.05, viaHoleDiameter: 0.1, minimumHoleGap: 0.05 }, audit)
  for (const bank of banks) for (const path of bank) {
    expect(finishPackingGenerator(geometry.unary(path, { connectionName: path.connectionName,
      points: [path.route[0]!, path.route.at(-1)!] }))).toBeTrue()
  }
  const forbidden = new Set(["0:0:1:1", "0:1:1:0", "1:0:2:1", "1:1:2:0", "0:0:2:0"])
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++)
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      expect(finishPackingGenerator(geometry.conflict(banks[i]![a]!, banks[j]![b]!)))
        .toBe(forbidden.has(`${i}:${a}:${j}:${b}`))
    }
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const selected: Array<[number, number]> = []
    for (const task of order) {
      const choice = banks[task]!.findIndex((path) => selected.every(([other, candidate]) =>
        !finishPackingGenerator(geometry.conflict(path, banks[other]![candidate]!))))
      if (choice === -1) break
      selected.push([task, choice])
    }
    expect(selected.length).toBeLessThan(3)
  }
  const feasible: number[][] = []
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    if (!finishPackingGenerator(geometry.conflict(banks[0]![a]!, banks[1]![b]!)) &&
      !finishPackingGenerator(geometry.conflict(banks[0]![a]!, banks[2]![c]!)) &&
      !finishPackingGenerator(geometry.conflict(banks[1]![b]!, banks[2]![c]!))) feasible.push([a, b, c])
  }
  expect(feasible).toEqual([[1, 1, 1]])
  const selected = finishPackingGenerator(selectPackedPaths(banks, geometry))!
  expect(selected.map((path, task) => banks[task]!.indexOf(path))).toEqual(feasible[0]!)
  expect(audit.selectionStates).toBeGreaterThan(3)
  expect(finishPackingGenerator(selectPackedPaths(banks, geometry, 1))).toBeNull()
})
