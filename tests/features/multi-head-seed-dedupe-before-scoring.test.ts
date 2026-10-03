import { expect, spyOn, test } from "bun:test"
import cn9630 from "fixtures/legacy/assets/cn9630-nodeWithPortPoints.json" with {
  type: "json",
}
import cn27910 from "fixtures/legacy/assets/cn27910-nodeWithPortPoints.json" with {
  type: "json",
}
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type {
  Candidate,
  PolyLine,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

function referenceHash(polyLines: PolyLine[]): string {
  const labels: string[] = []
  for (const line of polyLines) {
    const points: string[] = []
    for (const point of line.mPoints) {
      points.push(
        `${point.x.toFixed(2)},${point.y.toFixed(2)},${point.z1},${point.z2}`,
      )
    }
    labels.push(`${line.connectionName}-${points.join(",")}`)
  }
  return labels.sort().join("|")
}

class CountingSolver extends MultiHeadPolyLineIntraNodeSolver3 {
  gapScores = 0
}

class ScoreBeforeDedupeSolver extends CountingSolver {
  attemptedSeeds: number[] = []

  override setupInitialPolyLines(): void {
    this.candidates = []
    let permutations = 1
    for (let factor = 2; factor <= this.uniqueConnections; factor++) {
      permutations *= factor
    }
    const hashes = new Set<string>()
    for (let seed = 0; seed < Math.min(2000, permutations); seed++) {
      this.attemptedSeeds.push(seed)
      const candidate = this.createInitialCandidateFromSeed(seed)
      if (!candidate) continue
      this.gapScores++
      const hash = referenceHash(candidate.polyLines)
      if (hashes.has(hash)) continue
      hashes.add(hash)
      this.candidates.push(candidate)
    }
    this.candidates.sort((left, right) => left.f - right.f)
  }
}

class OverriddenFactorySolver extends CountingSolver {
  attemptedSeeds: number[] = []
  receivedRetainedHashes = false

  override createInitialCandidateFromSeed(
    seed: number,
    retainedPolylineHashes?: ReadonlySet<string>,
  ): Candidate | null {
    this.attemptedSeeds.push(seed)
    this.receivedRetainedHashes ||= retainedPolylineHashes !== undefined
    return super.createInitialCandidateFromSeed(seed)
  }
}

class MutatingScoreSolver extends CountingSolver {
  scoredSeeds = 0
  attemptedSeeds: number[] = []

  override computeG(polyLines: PolyLine2[], candidate: Candidate): number {
    this.scoredSeeds++
    if (this.scoredSeeds > 1) {
      candidate.polyLines[0]!.mPoints[0]!.x += this.scoredSeeds / 100
    }
    return super.computeG(polyLines, candidate)
  }
}

function installMutatingInstanceScore(solver: CountingSolver): { calls: number } {
  const state = { calls: 0 }
  const originalG = MultiHeadPolyLineIntraNodeSolver2.prototype.computeG
  solver.computeG = (polyLines: PolyLine2[], candidate: Candidate): number => {
    state.calls++
    if (state.calls > 1) {
      candidate.polyLines[0]!.mPoints[0]!.x += state.calls / 100
    }
    return originalG.call(solver, polyLines, candidate)
  }
  return state
}

test("seed dedupe preserves candidates and forces while skipping duplicate scores", (): void => {
  let skippedScores = 0
  const parallelNode: NodeWithPortPoints = {
    capacityMeshNodeId: "parallel-seed-dedupe",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    portPoints: [-4, -2, 0, 2, 4].flatMap((y, index) => [
      { x: -5, y, z: 0, connectionName: `parallel-${index}` },
      { x: 5, y, z: 0, connectionName: `parallel-${index}` },
    ]),
  }
  for (const nodeWithPortPoints of [
    cn9630.nodeWithPortPoints,
    cn27910.nodeWithPortPoints,
    parallelNode,
  ]) {
    const params = {
      nodeWithPortPoints,
      hyperParameters: { SEGMENTS_PER_POLYLINE: 5 },
    }
    const optimized = new CountingSolver(structuredClone(params))
    const reference = new ScoreBeforeDedupeSolver(structuredClone(params))
    optimized.step()
    reference.step()
    const expectedSeedCount = nodeWithPortPoints === parallelNode ? 120 : 6
    expect(reference.attemptedSeeds).toEqual(
      Array.from({ length: expectedSeedCount }, (_, index) => index),
    )
    expect(optimized.candidates).toEqual(reference.candidates)
    expect(reference.gapScores).toBeGreaterThanOrEqual(
      optimized.candidates.length,
    )
    skippedScores += reference.gapScores - optimized.candidates.length

    const optimizedDirect = new CountingSolver(structuredClone(params))
    const referenceDirect = new ScoreBeforeDedupeSolver(structuredClone(params))
    const directCandidate = optimizedDirect.createInitialCandidateFromSeed(0)
    expect(directCandidate).toEqual(
      referenceDirect.createInitialCandidateFromSeed(0),
    )

    const overridden = new OverriddenFactorySolver(structuredClone(params))
    overridden.step()
    expect(overridden.receivedRetainedHashes).toBe(false)
    expect(overridden.attemptedSeeds).toEqual(reference.attemptedSeeds)
    expect(overridden.candidates).toEqual(reference.candidates)

    const mutating = new MutatingScoreSolver(structuredClone(params))
    const mutatingReference = new MutatingScoreSolver(structuredClone(params))
    mutating.step()
    ScoreBeforeDedupeSolver.prototype.setupInitialPolyLines.call(
      mutatingReference,
    )
    expect(mutating.scoredSeeds).toBe(mutatingReference.scoredSeeds)
    expect(mutating.candidates).toEqual(mutatingReference.candidates)

    const instance = new CountingSolver(structuredClone(params))
    const instanceReference = new ScoreBeforeDedupeSolver(structuredClone(params))
    const instanceScores = installMutatingInstanceScore(instance)
    const referenceScores = installMutatingInstanceScore(instanceReference)
    instance.step()
    instanceReference.step()
    expect(instanceScores.calls).toBe(referenceScores.calls)
    expect(instance.candidates).toEqual(instanceReference.candidates)

    optimized.solve()
    reference.solve()
    expect(optimized.iterations).toBe(reference.iterations)
    expect(optimized.solved).toBe(reference.solved)
    expect(optimized.failed).toBe(reference.failed)
    expect(optimized.error).toBe(reference.error)
    expect(optimized.lastCandidate).toEqual(reference.lastCandidate)
    expect(optimized.candidates).toEqual(reference.candidates)
    expect(optimized.solvedRoutes).toEqual(reference.solvedRoutes)
  }
  expect(skippedScores).toBeGreaterThan(0)
  // The old setup counts fully scored successful seeds. Check the rejection
  // boundary directly without replacing the native hooks used by setup.
  const proofParams = {
    nodeWithPortPoints: parallelNode,
    hyperParameters: { SEGMENTS_PER_POLYLINE: 5 },
  }
  const directProbe = new CountingSolver(structuredClone(proofParams))
  const initial = directProbe.createInitialCandidateFromSeed(0)!
  const retained = new Set([referenceHash(initial.polyLines)])
  const originalGap =
    MultiHeadPolyLineIntraNodeSolver.prototype.computeMinGapBtwPolyLines
  let directGapCalls = 0
  const gapSpy = spyOn(
    MultiHeadPolyLineIntraNodeSolver.prototype,
    "computeMinGapBtwPolyLines",
  ).mockImplementation(function (
    this: MultiHeadPolyLineIntraNodeSolver,
    polyLines: PolyLine2[],
  ): number[] {
    directGapCalls++
    return originalGap.call(this, polyLines)
  })
  try {
    expect(directProbe.createInitialCandidateFromSeed(0, retained)).toBeNull()
    expect(directGapCalls).toBe(0)
    expect(directProbe.createInitialCandidateFromSeed(0)).toEqual(initial)
    expect(directGapCalls).toBe(1)
  } finally {
    gapSpy.mockRestore()
  }

  const originalG = MultiHeadPolyLineIntraNodeSolver2.prototype.computeG
  const prototypeScoreCalls = new WeakMap<
    MultiHeadPolyLineIntraNodeSolver2,
    number
  >()
  try {
    MultiHeadPolyLineIntraNodeSolver2.prototype.computeG = function (
      this: MultiHeadPolyLineIntraNodeSolver2,
      polyLines: PolyLine2[],
      candidate: Candidate,
    ): number {
      const calls = (prototypeScoreCalls.get(this) ?? 0) + 1
      prototypeScoreCalls.set(this, calls)
      if (calls > 1) candidate.polyLines[0]!.mPoints[0]!.x += calls / 100
      return originalG.call(this, polyLines, candidate)
    }
    const patched = new CountingSolver(structuredClone(proofParams))
    const patchedReference = new ScoreBeforeDedupeSolver(
      structuredClone(proofParams),
    )
    patched.step()
    patchedReference.step()
    expect(prototypeScoreCalls.get(patched)).toBe(120)
    expect(prototypeScoreCalls.get(patchedReference)).toBe(120)
    expect(patched.candidates).toEqual(patchedReference.candidates)
  } finally {
    MultiHeadPolyLineIntraNodeSolver2.prototype.computeG = originalG
  }
})
