import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { convertSrjToGraphicsObject } from "../../lib"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import type { SimpleRouteJson } from "lib/types"

const shouldAttemptRemoteSolve = (metadata: {
  pairCount: number
  node: { availableZ?: number[] }
}) => metadata.pairCount >= 3 && metadata.node.availableZ?.length !== 1

test.skip(
  "pipeline5 visualizes exact high-density solver metadata for dataset01 circuit001",
  async () => {
    const circuit001 = (dataset01 as Record<string, unknown>)
      .circuit001 as SimpleRouteJson

    const pipeline4Input = structuredClone(circuit001)
    const pipeline5Input = structuredClone(circuit001)

    const pipeline4Solver = new AutoroutingPipelineSolver4(pipeline4Input)
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
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.remoteRequestsStarted,
    ).toBe(
      Array.from(
        (
          pipeline5Solver.highDensityRouteSolver as
            | Pipeline5HdCacheHighDensitySolver
            | undefined
        )?.nodeSolveMetadataById.values() ?? [],
      ).filter(shouldAttemptRemoteSolve).length,
    )

    const highDensitySolver = pipeline5Solver.highDensityRouteSolver as
      | Pipeline5HdCacheHighDensitySolver
      | undefined
    const nodeSolveMetadata = Array.from(
      highDensitySolver?.nodeSolveMetadataById.values() ?? [],
    )
    const markerPoints = highDensitySolver?.visualize().points ?? []
    const markerLabels = markerPoints.map((point) => point.label ?? "")

    expect(nodeSolveMetadata.length).toBeGreaterThan(0)
    expect(nodeSolveMetadata.length).toBe(
      pipeline5Solver.highDensityNodePortPoints?.length ?? 0,
    )
    expect(markerLabels.length).toBe(nodeSolveMetadata.length)
    expect(markerPoints.every((point) => point.color === "blue")).toBe(true)
    expect(highDensitySolver?.stats.localFallbackNodeCount).toBe(
      nodeSolveMetadata.filter(
        (metadata) => metadata.resolution === "local-fallback",
      ).length,
    )
    expect(highDensitySolver?.stats.localDirectNodeCount).toBe(
      nodeSolveMetadata.filter((metadata) => metadata.resolution === "local")
        .length,
    )
    expect(highDensitySolver?.stats.localSolvedNodeCount).toBe(
      nodeSolveMetadata.filter((metadata) =>
        ["local", "local-fallback"].includes(metadata.resolution),
      ).length,
    )

    for (const metadata of nodeSolveMetadata) {
      expect(metadata.status).toBe("solved")
      expect(metadata.remoteAttempt.attempted).toBe(
        shouldAttemptRemoteSolve(metadata),
      )
      expect(metadata.solverType.length).toBeGreaterThan(0)
      if (metadata.resolution === "local") {
        expect(shouldAttemptRemoteSolve(metadata)).toBe(false)
        expect(metadata.remoteAttempt.attempted).toBe(false)
        expect(metadata.supervisorType).toBe("HyperSingleIntraNodeSolver")
      } else if (metadata.resolution === "local-fallback") {
        expect(shouldAttemptRemoteSolve(metadata)).toBe(true)
        expect(metadata.remoteAttempt.attempted).toBe(true)
        expect(metadata.remoteAttempt.error).toBeTruthy()
        expect(metadata.supervisorType).toBe("HyperSingleIntraNodeSolver")
      } else {
        expect(metadata.resolution).toBe("remote")
        expect(shouldAttemptRemoteSolve(metadata)).toBe(true)
        expect(metadata.remoteAttempt.attempted).toBe(true)
        expect(metadata.solverType).toContain("hd-cache.tscircuit.com")
      }
    }

    for (const label of markerLabels) {
      expect(label).toContain("solver: ")
      expect(label).toContain("pairCount: ")
      expect(label).toContain("resolution: ")
      expect(label).toContain("remoteAttempted: ")
      expect(label).not.toContain("remoteEndpoint: ")
      expect(label).not.toContain("connections: ")
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
