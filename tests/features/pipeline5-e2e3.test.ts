import { expect, test } from "bun:test"
import { convertSrjToGraphicsObject } from "../../lib"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import type { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../../fixtures/legacy/assets/e2e3.json"

const shouldAttemptRemoteSolve = (metadata: {
  pairCount: number
  node: { availableZ?: number[] }
}) => metadata.pairCount >= 3 && metadata.node.availableZ?.length !== 1

test.skip(
  "pipeline5 routes pair-count >= 3 nodes remotely for e2e3",
  async () => {
    const pipeline4Input = structuredClone(e2e3Fixture as SimpleRouteJson)
    const pipeline5Input = structuredClone(e2e3Fixture as SimpleRouteJson)

    const pipeline4Solver = new AutoroutingPipelineSolver4(pipeline4Input, {
      maxNodeDimension: 8,
    })
    pipeline4Solver.solve()

    const pipeline5Solver = new AutoroutingPipelineSolver5(pipeline5Input)
    await pipeline5Solver.solveAsync()
    const pipeline4Output = pipeline4Solver.getOutputSimpleRouteJson()
    const pipeline5Output = pipeline5Solver.getOutputSimpleRouteJson()
    const pipeline4Traces = pipeline4Output.traces ?? []
    const pipeline5Traces = pipeline5Output.traces ?? []

    expect(pipeline4Solver.solved).toBe(true)
    expect(pipeline4Solver.failed).toBe(false)
    expect(pipeline5Solver.solved).toBe(true)
    expect(pipeline5Solver.failed).toBe(false)

    const highDensitySolver = pipeline5Solver.highDensityRouteSolver as
      | Pipeline5HdCacheHighDensitySolver
      | undefined
    const nodeSolveMetadata = Array.from(
      highDensitySolver?.nodeSolveMetadataById.values() ?? [],
    )
    const remoteEligibleNodeCount = nodeSolveMetadata.filter(
      shouldAttemptRemoteSolve,
    ).length
    const localOnlyNodeCount = nodeSolveMetadata.filter(
      (metadata) => !shouldAttemptRemoteSolve(metadata),
    ).length

    expect(highDensitySolver?.stats.remoteRequestsStarted).toBe(
      remoteEligibleNodeCount,
    )
    expect(highDensitySolver?.stats.localDirectNodeCount).toBe(
      localOnlyNodeCount,
    )
    expect(highDensitySolver?.stats.localSolvedNodeCount).toBe(
      nodeSolveMetadata.filter((metadata) =>
        ["local", "local-fallback"].includes(metadata.resolution),
      ).length,
    )

    for (const metadata of nodeSolveMetadata) {
      expect(metadata.remoteAttempt.attempted).toBe(
        shouldAttemptRemoteSolve(metadata),
      )
      if (!shouldAttemptRemoteSolve(metadata)) {
        expect(metadata.resolution).toBe("local")
      } else {
        expect(["remote", "local-fallback"]).toContain(metadata.resolution)
      }
    }

    expect(pipeline5Traces.length).toBe(pipeline4Traces.length)
    expect(
      [
        ...new Set(pipeline5Traces.map((trace) => trace.connection_name)),
      ].sort(),
    ).toEqual(
      [
        ...new Set(pipeline4Traces.map((trace) => trace.connection_name)),
      ].sort(),
    )
    expect(convertSrjToGraphicsObject(pipeline5Output)).toMatchGraphicsSvg(
      import.meta.path,
    )
  },
  { timeout: 120_000 },
)
