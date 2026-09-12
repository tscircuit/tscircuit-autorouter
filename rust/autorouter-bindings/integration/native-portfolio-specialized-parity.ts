import assert from "node:assert/strict"
import { PortfolioSingleIntraNodeSolver } from "../../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { SpecializedIntraNodeSolverAdapter } from "../../../lib/bindings/high-density/SpecializedIntraNodeSolverAdapter"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"

type Child = { iterations: number; MAX_ITERATIONS: number; solved: boolean; failed: boolean; progress: number; error: string | null; solvedRoutes: unknown[] }
type Owner = { step(): void; solved: boolean; failed: boolean; iterations: number; MIN_SUBSTEPS: number; error: string | null; supervisedSolvers?: { solver: Child; g: number; h: number; f: number }[]; generateSolver: (...args: unknown[]) => unknown }
function compare(actual: unknown, expected: unknown, path: string): void {
  if (actual !== null && expected !== null && typeof actual === "object" && typeof expected === "object") {
    const left = actual as Record<string, unknown>
    const right = expected as Record<string, unknown>
    assert.deepEqual(Object.keys(left), Object.keys(right), `${path} keys`)
    for (const key of Object.keys(left)) compare(left[key], right[key], `${path}.${key}`)
    return
  }
  assert.equal(actual, expected, path)
}
const referenceRoot = process.env.TSCIRCUIT_TS_REFERENCE
if (!referenceRoot) throw new Error("Set TSCIRCUIT_TS_REFERENCE to the frozen TypeScript checkout")
const { PortfolioSingleIntraNodeSolver: ReferencePortfolio } = await import(`${referenceRoot}/lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts`)
const node: NodeWithPortPoints = {
  capacityMeshNodeId: "native-specialized-dispatch", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", x: -2, y: 0, z: 0 }, { connectionName: "a", x: 2, y: 0, z: 0 },
    { connectionName: "b", x: 0, y: -2, z: 0 }, { connectionName: "b", x: 0, y: 2, z: 0 },
  ],
}
const fixtures = [
  ["MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver", "MultiHeadPolyLineIntraNodeSolver"],
  ["MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized", "MultiHeadPolyLineIntraNodeSolver2"],
  ["MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration", "MultiHeadPolyLineIntraNodeSolver3"],
  ["TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver", "TwoCrossingRoutesHighDensitySolver"],
  ["SingleTransitionIntraNodeSolver", "SingleTransitionIntraNodeSolver"],
] as const
const originalStep = SpecializedIntraNodeSolverAdapter.prototype._step
let checked = 0
let mutations = 0
SpecializedIntraNodeSolverAdapter.prototype._step = function (): never {
  throw new Error("Specialized portfolio candidate crossed back into TypeScript _step")
}
try {
  for (const [path, name] of fixtures) {
    const Actual = (await import(`../../../lib/solvers/HighDensitySolver/${path}.ts`))[name]
    const Reference = (await import(`${referenceRoot}/lib/solvers/HighDensitySolver/${path}.ts`))[name]
    const props = { nodeWithPortPoints: node, viaDiameter: 0.3, hyperParameters: { SEGMENTS_PER_POLYLINE: 3 } }
    const actual = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: node }) as unknown as Owner
    const reference = new ReferencePortfolio({ nodeWithPortPoints: structuredClone(node) }) as Owner
    actual.MIN_SUBSTEPS = reference.MIN_SUBSTEPS = 1
    actual.generateSolver = (hyperParameters): Child => Object.assign(new Actual({ ...props, hyperParameters }), { hyperParameters })
    reference.generateSolver = (hyperParameters): Child => Object.assign(new Reference(structuredClone({ ...props, hyperParameters })), { hyperParameters })
    for (let step = 0; !reference.solved && !reference.failed; step++) {
      assert.ok(step < 2000, `${name} exceeded focused test step budget`)
      actual.step()
      reference.step()
      const view = (owner: Owner): unknown => ({
        iterations: owner.iterations, solved: owner.solved, failed: owner.failed, error: owner.error,
        candidates: owner.supervisedSolvers?.map(({ solver, g, h, f }) => ({
          g, h, f, iterations: solver.iterations, max: solver.MAX_ITERATIONS, solved: solver.solved,
          failed: solver.failed, progress: solver.progress, error: solver.error, routes: solver.solvedRoutes,
        })),
      })
      compare(JSON.parse(JSON.stringify(view(actual))), JSON.parse(JSON.stringify(view(reference))), `${name} public step ${step}`)
      if (step === 0 && !reference.solved && !reference.failed) {
        mutations++
        for (const owner of [actual, reference]) {
          for (const { solver } of owner.supervisedSolvers!) {
            solver.MAX_ITERATIONS = 20_000
            solver.progress = 0.125
          }
        }
      }
      checked++
    }
    console.log(`${name}: native-only candidate stepping and public state parity passed`)
  }
} finally {
  SpecializedIntraNodeSolverAdapter.prototype._step = originalStep
}
assert.ok(mutations > 0, "Fixtures must exercise mutations between native portfolio steps")
console.log(`Native specialized portfolio parity passed: ${checked} public steps`)
