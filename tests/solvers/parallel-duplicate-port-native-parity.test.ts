import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { DuplicateCongestedPortSolver } from "tiny-hypergraph/lib/DuplicateCongestedPortSolver"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { ParallelDuplicateCongestedPortSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelDuplicateCongestedPortSolver"
import type { IndependentDuplicateRouteDiagnostic } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelDuplicateCongestedPortSolver"

function fixture(seed: number): SerializedHyperGraph {
  let value = seed + 12345
  const random = (): number => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296 }
  const count = 2 + Math.floor(random() * 5)
  const routes = 2 + Math.floor(random() * 5)
  const regions: SerializedHyperGraph["regions"] = []
  const ports: SerializedHyperGraph["ports"] = []
  const connections: NonNullable<SerializedHyperGraph["connections"]> = []
  for (let i = 0; i < count; i++) regions.push({ regionId: `r${i}`, pointIds: [], d: {
    center: { x: i * 3, y: 0 }, width: 3, height: 2 + random() * 4, availableZ: [0, 1],
  } })
  const addPort = (id: string, a: string, b: string, x: number, y: number, z: number): void => {
    ports.push({ portId: id, region1Id: a, region2Id: b, d: { x, y, z,
      tinyHypergraphPortPenalty: seed % 3 === 0 ? random() * 3 : 0 } })
    regions.find((r) => r.regionId === a)!.pointIds.push(id)
    regions.find((r) => r.regionId === b)!.pointIds.push(id)
  }
  for (let i = 0; i < count - 1; i++) {
    for (let j = 0; j < 2 + seed % 4; j++) addPort(`p${i}:${j}`, `r${i}`, `r${i + 1}`, i * 3 + 1.5, random() * 2 - 1, j % 2)
  }
  for (let route = 0; route < routes; route++) {
    regions.push({ regionId: `s${route}`, pointIds: [], d: { center: { x: -3, y: route * 0.1 }, width: 2, height: 1, availableZ: [route % 2] } })
    regions.push({ regionId: `e${route}`, pointIds: [], d: { center: { x: count * 3, y: route * 0.1 }, width: 2, height: 1, availableZ: [route % 2] } })
    addPort(`sp${route}`, `s${route}`, "r0", -1.5, route * 0.1, route % 2)
    addPort(`ep${route}`, `r${count - 1}`, `e${route}`, count * 3 - 1.5, route * 0.1, route % 2)
    connections.push({ connectionId: `c${route}`, startRegionId: `s${route}`, endRegionId: `e${route}`, mutuallyConnectedNetworkId: `net${route % 3}` })
  }
  return { regions, ports, connections }
}

test("indexed duplicate discovery preserves random native graph/report/search budgets and failures", (): void => {
  let hits = 0
  let successful = 0
  for (let seed = 0; seed < 40; seed++) {
    const input = fixture(seed)
    for (const maxIterations of [1, 100_000]) {
      const options = { duplicatePortProximity: 0.05, useSerializedPortPenalties: seed % 2 === 0,
        routeSolveOptions: { MAX_ITERATIONS: maxIterations, STATIC_REACHABILITY_PRECHECK: true,
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0, minViaPadDiameter: 0.2 + seed % 5 * 0.05 } }
      const original = new DuplicateCongestedPortSolver(structuredClone(input), options)
      const nativeDiagnostics: IndependentDuplicateRouteDiagnostic[] = []
      const nativeSolve = TinyHyperGraphSolver.prototype.solve
      TinyHyperGraphSolver.prototype.solve = function (): void {
        nativeSolve.call(this)
        // Timeout completion creates separate 50k-budget greedy children.
        if (this.MAX_ITERATIONS === maxIterations) {
          nativeDiagnostics.push({ routeId: nativeDiagnostics.length, iterations: this.iterations,
            maxIterations: this.MAX_ITERATIONS, solved: this.solved, failed: this.failed })
        }
      }
      try { original.solve() } finally { TinyHyperGraphSolver.prototype.solve = nativeSolve }
      const indexed = new ParallelDuplicateCongestedPortSolver(structuredClone(input), options)
      indexed.collectCostIndexDiagnostics = true
      indexed.solve()
      expect(indexed.solved).toBe(original.solved)
      expect(indexed.failed).toBe(original.failed)
      expect(indexed.error).toBe(original.error)
      expect(indexed.report).toEqual(original.report)
      expect(indexed.routeDiagnostics).toEqual(nativeDiagnostics)
      expect(indexed.serializedHyperGraph).toEqual(original.serializedHyperGraph)
      if (original.solved && !original.failed) {
        successful++
        expect(indexed.getOutput()).toEqual(original.getOutput())
        expect(indexed.stats.duplicateSourcePortCount).toBe(original.stats.duplicateSourcePortCount)
        expect(indexed.stats.duplicatedPortCount).toBe(original.stats.duplicatedPortCount)
      } else expect(() => indexed.getOutput()).toThrow(original.error ? "does not have a repaired topology output" : "repaired topology")
      hits += indexed.costIndexDiagnostics.hits
    }
  }
  expect(successful).toBeGreaterThan(20)
  expect(hits).toBeGreaterThan(0)
  const unreachable = fixture(17)
  unreachable.ports = unreachable.ports.filter((port) => !port.portId.startsWith("p0:"))
  const existing = new Set(unreachable.ports.map((port) => port.portId))
  for (const region of unreachable.regions) region.pointIds = region.pointIds.filter((id) => existing.has(id))
  const native = new DuplicateCongestedPortSolver(structuredClone(unreachable))
  const indexed = new ParallelDuplicateCongestedPortSolver(structuredClone(unreachable))
  native.solve(); indexed.solve()
  expect(native.failed).toBe(true)
  expect(indexed.failed).toBe(true)
  expect(indexed.error).toBe(native.error)
})
