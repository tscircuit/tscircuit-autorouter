import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import type { SimpleRouteJson } from "lib/types"

test.skip(
  "pipeline5 visualizes the exact remote attempt outcome for dataset01 circuit005",
  async () => {
    const circuit005 = (dataset01 as Record<string, unknown>)
      .circuit005 as SimpleRouteJson

    const pipeline4Solver = new AutoroutingPipelineSolver4(
      structuredClone(circuit005),
      { maxNodeDimension: 8 },
    )
    pipeline4Solver.solve()

    const pipeline5Solver = new AutoroutingPipelineSolver5(
      structuredClone(circuit005),
    )
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
    ).toBeGreaterThan(0)
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.remoteRequestsCompleted,
    ).toBe(pipeline5Solver.highDensityRouteSolver?.stats.remoteRequestsStarted)
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.remoteResponseSampleCount,
    ).toBe(
      pipeline5Solver.highDensityRouteSolver?.stats.remoteRequestsCompleted,
    )
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.slowestRemoteResponseMs,
    ).toBeGreaterThan(0)
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.slowestRemoteResponseNodeId,
    ).toBeTruthy()
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.p50RemoteResponseMs,
    ).toBeGreaterThan(0)
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.slowestRemoteResponseMs,
    ).toBeGreaterThanOrEqual(
      pipeline5Solver.highDensityRouteSolver?.stats.p50RemoteResponseMs,
    )
    expect(
      pipeline5Solver.highDensityRouteSolver?.stats.localFallbackNodeCount,
    ).toBeGreaterThanOrEqual(0)

    const highDensitySolver = pipeline5Solver.highDensityRouteSolver as
      | Pipeline5HdCacheHighDensitySolver
      | undefined
    const remoteNodeEntry = Array.from(
      highDensitySolver?.nodeSolveMetadataById.entries() ?? [],
    ).find(([, metadata]) => metadata.remoteAttempt.attempted)
    const remoteNodeId = remoteNodeEntry?.[0]
    const remoteNodeMetadata = remoteNodeEntry?.[1]
    const remoteNodeMarker = highDensitySolver
      ?.visualize()
      .points?.find((point) =>
        remoteNodeId ? point.label?.includes(`node: ${remoteNodeId}`) : false,
      )
    const remoteNodeMarkerLabel = remoteNodeMarker?.label

    expect(remoteNodeMetadata).toBeDefined()
    expect(remoteNodeMetadata?.status).toBe("solved")
    expect(remoteNodeMetadata?.pairCount).toBeGreaterThanOrEqual(3)
    expect(remoteNodeMetadata?.remoteAttempt.attempted).toBe(true)
    expect(remoteNodeMarker?.color).toBe("blue")
    expect(remoteNodeMarkerLabel).toContain(`node: ${remoteNodeId}`)
    expect(remoteNodeMarkerLabel).toContain("resolution: ")
    expect(remoteNodeMarkerLabel).toContain("solver: ")
    expect(remoteNodeMarkerLabel).toContain("pairCount: ")
    expect(remoteNodeMarkerLabel).toContain("remoteAttempted: yes")
    expect(remoteNodeMarkerLabel).not.toContain("remoteEndpoint: ")
    expect(remoteNodeMarkerLabel).not.toContain("connections: ")
    expect(remoteNodeMarkerLabel).toContain("remoteDurationMs: ")

    if (remoteNodeMetadata?.resolution === "local-fallback") {
      expect(remoteNodeMetadata.remoteAttempt.source).toBe("error")
      expect(remoteNodeMetadata.remoteAttempt.error).toBeTruthy()
      expect(remoteNodeMetadata.remoteAttempt.durationMs).toBeGreaterThan(0)
      expect(remoteNodeMetadata.solverType).not.toContain("hd-cache")
      expect(remoteNodeMetadata.supervisorType).toBe(
        "HyperSingleIntraNodeSolver",
      )
      expect(remoteNodeMarkerLabel).toContain("resolution: local-fallback")
      expect(remoteNodeMarkerLabel).toContain(
        "supervisor: HyperSingleIntraNodeSolver",
      )
      expect(remoteNodeMarkerLabel).toContain("remoteSource: error")
      expect(remoteNodeMarkerLabel).toContain("remoteError: ")
    } else {
      expect(remoteNodeMetadata?.resolution).toBe("remote")
      expect(remoteNodeMetadata?.solverType).toContain("hd-cache.tscircuit.com")
      expect(remoteNodeMetadata?.remoteAttempt.source).toMatch(/cache|solver/)
      expect(remoteNodeMetadata?.remoteAttempt.durationMs).toBeGreaterThan(0)
      expect(remoteNodeMarkerLabel).toContain("resolution: remote")
      expect(remoteNodeMarkerLabel).toContain("remoteSource: ")
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
  },
  { timeout: 120_000 },
)
