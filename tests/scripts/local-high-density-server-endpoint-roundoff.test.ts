import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { HdCache2Client } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/HdCache2Client"
import {
  PIPELINE9_NETWORKED_SOLVE_POLICY,
  type Pipeline9NetworkedHighDensityNodeInput,
  type Pipeline9NetworkedHighDensityNodeOutput,
  type Pipeline9NetworkedSolveResponse,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { solvePipeline9NetworkedHighDensityNode } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { getGlobalInMemoryCache } from "../../lib/cache/setupGlobalCaches"
import type { PortPoint } from "../../lib/types/high-density-types"
import { createLocalHighDensityServer } from "../../scripts/benchmark/createLocalHighDensityServer"
import {
  normalizeLocalHighDensityJson,
  type LocalHighDensityObject,
} from "../../scripts/benchmark/localHighDensityProtocol"
import { normalizeLocalHighDensityNodeResult } from "../../scripts/benchmark/normalizeLocalHighDensityNodeResult"

type SuccessfulResponse = Extract<Pipeline9NetworkedSolveResponse, { ok: true }>
type ResponseParser = {
  parseSuccessfulResponse: (
    value: unknown,
    input: Pipeline9NetworkedHighDensityNodeInput,
  ) => SuccessfulResponse
}

test("local helper restores roundoff-only terminal identities before cold and hot client validation", async () => {
  const cases = [
    {
      name: "half-grid",
      center: { x: 1.971437, y: -4.813414 },
      width: 4.073126,
      height: 3.913172,
      start: { x: 0.8187574999999999, y: -2.8568279999999997, z: 0 },
      end: { x: 2.1235, y: -2.8568279999999997, z: 3 },
      layerCount: 4,
      changedAxis: "x" as const,
    },
    {
      name: "signed-zero",
      center: { x: 27.253999999999998, y: 1.9159999999999995 },
      width: 2.4659999999999975,
      height: 5.4879999999999995,
      start: { x: 27.253999999999998, y: -0.8280000000000003, z: 1 },
      end: { x: 28.486999999999995, y: -5.551115123125783e-17, z: 0 },
      layerCount: 2,
      changedAxis: "y" as const,
    },
  ]
  const faults: Error[] = []
  const handler = createLocalHighDensityServer({
    autorouterVersion: AUTOROUTER_VERSION,
    solve: (value: LocalHighDensityObject): LocalHighDensityObject => {
      const input = value as unknown as Pipeline9NetworkedHighDensityNodeInput
      getGlobalInMemoryCache().clearCache()
      return normalizeLocalHighDensityJson(
        normalizeLocalHighDensityNodeResult(
          input,
          solvePipeline9NetworkedHighDensityNode(input),
        ),
      ) as LocalHighDensityObject
    },
    onFault: (error: Error): void => {
      faults.push(error)
    },
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler.fetch,
  })
  const cacheVersion = "roundoff-only-terminals"
  const client = new HdCache2Client(
    AUTOROUTER_VERSION,
    `http://127.0.0.1:${server.port}`,
    { cacheVersion },
  )
  const parser = client as unknown as ResponseParser
  const identity = {
    ok: true,
    autorouterVersion: AUTOROUTER_VERSION,
    cacheVersion,
    source: "solver",
  }

  try {
    for (const fixture of cases) {
      const connectionName = `${fixture.name}-connection`
      const start: PortPoint = {
        ...fixture.start,
        connectionName,
        rootConnectionName: `${fixture.name}-root`,
        portPointId: `${fixture.name}-start`,
        pcb_port_id: `${fixture.name}-pcb-start`,
        nextPortPointId: `${fixture.name}-end`,
      }
      const end: PortPoint = {
        ...fixture.end,
        connectionName,
        rootConnectionName: `${fixture.name}-root`,
        portPointId: `${fixture.name}-end`,
        pcb_port_id: `${fixture.name}-pcb-end`,
        prevPortPointId: `${fixture.name}-start`,
      }
      const input: Pipeline9NetworkedHighDensityNodeInput = {
        solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY,
        enableRegionalFallback: false,
        nodeWithPortPoints: {
          capacityMeshNodeId: fixture.name,
          center: fixture.center,
          width: fixture.width,
          height: fixture.height,
          availableZ: Array.from({ length: fixture.layerCount }, (_, z) => z),
          portPoints: [start, end],
          portPointsInPairs: [[start, end]],
        },
        connectivityNetMap: {},
        colorMap: {},
        viaDiameter: 0.3,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        effort: 1,
        obstacles: [],
        regionalObstacles: [],
        layerCount: fixture.layerCount,
        nodePf: null,
      }
      getGlobalInMemoryCache().clearCache()
      const raw = solvePipeline9NetworkedHighDensityNode(input)
      expect(raw.status).toBe("solved")
      expect(raw.solutionStage).toBe("ordinary")
      if (raw.status !== "solved" || raw.solutionStage !== "ordinary") {
        throw new Error(`${fixture.name} must reproduce an ordinary solve`)
      }
      expect(raw.routes).toHaveLength(1)
      const rawBefore = structuredClone(raw)
      const rawRoute = raw.routes[0]!
      const terminal = fixture.changedAxis === "x" ? start : end
      const endpointIndex =
        rawRoute.route[0]!.z === terminal.z ? 0 : rawRoute.route.length - 1
      const rawEndpoint = rawRoute.route[endpointIndex]!
      expect(rawEndpoint[fixture.changedAxis]).not.toBe(
        terminal[fixture.changedAxis],
      )
      expect(rawEndpoint[fixture.changedAxis].toFixed(6)).not.toBe(
        terminal[fixture.changedAxis].toFixed(6),
      )
      expect(() =>
        parser.parseSuccessfulResponse({ ...identity, ...raw }, input),
      ).toThrow("invalid solve result")

      const normalized = normalizeLocalHighDensityNodeResult(input, raw)
      const expected = structuredClone(raw)
      for (const index of [0, expected.routes[0]!.route.length - 1]) {
        const point = expected.routes[0]!.route[index]!
        const port = point.z === start.z ? start : end
        point.x = port.x
        point.y = port.y
      }
      expect(normalized).toEqual(expected)
      expect(raw).toEqual(rawBefore)
      expect(
        parser.parseSuccessfulResponse({ ...identity, ...normalized }, input),
      ).toMatchObject({ status: "solved", solutionStage: "ordinary" })

      const metadata = structuredClone(raw)
      const metadataPoint = metadata.routes[0]!.route[endpointIndex]!
      metadata.routes[0]!.startPcbPortId = "locked-start"
      metadataPoint.traceThickness = 0.12
      metadataPoint.pcb_port_id = "locked-port"
      metadataPoint.insideJumperPad = true
      metadataPoint.toNextSegmentType = "through_obstacle"
      metadataPoint.toNextSegmentCircuitJsonMetadata = { pcb_smtpad_id: "pad" }
      const normalizedMetadata = normalizeLocalHighDensityNodeResult(
        input,
        metadata,
      )
      expect(normalizedMetadata).toEqual({
        ...expected,
        routes: [
          {
            ...expected.routes[0]!,
            startPcbPortId: "locked-start",
            route: expected.routes[0]!.route.map((point, index) =>
              index === endpointIndex
                ? { ...metadataPoint, x: terminal.x, y: terminal.y }
                : point,
            ),
          },
        ],
      })

      const displaced = structuredClone(expected)
      displaced.routes[0]!.route[endpointIndex]![fixture.changedAxis] += 1e-9
      const normalizedDisplaced = normalizeLocalHighDensityNodeResult(
        input,
        displaced,
      )
      expect(normalizedDisplaced).toEqual(displaced)
      expect(() =>
        parser.parseSuccessfulResponse(
          { ...identity, ...normalizedDisplaced },
          input,
        ),
      ).toThrow("invalid solve result")
      const failed: Pipeline9NetworkedHighDensityNodeOutput = {
        status: "failed",
        solutionStage: "ordinary",
        error: "terminal failure",
      }
      expect(normalizeLocalHighDensityNodeResult(input, failed)).toBe(failed)
      const regional: Pipeline9NetworkedHighDensityNodeOutput = {
        ...raw,
        solutionStage: "regional-fallback",
        ordinaryFailure: "ordinary failed",
      }
      expect(normalizeLocalHighDensityNodeResult(input, regional)).toBe(
        regional,
      )

      const cold = await client.solveMany([input])[0]!
      expect(cold.kind).toBe("remote")
      if (cold.kind !== "remote") throw new Error(cold.error)
      expect(cold.response).toMatchObject({ source: "solver", ...expected })
      const hot = await client.solveMany([input])[0]!
      expect(hot.kind).toBe("remote")
      if (hot.kind !== "remote") throw new Error(hot.error)
      expect(hot.response).toMatchObject({ source: "cache", ...expected })
    }
    expect(handler.stats.jobsComputed).toBe(2)
    expect(handler.stats.cacheHits).toBe(2)
    expect(handler.stats.cacheMisses).toBe(2)
    expect(client.stats.batchInvalidLines).toBe(0)
    expect(client.stats.singleRequestsStarted).toBe(2)
    expect(faults).toEqual([])
  } finally {
    server.stop(true)
    getGlobalInMemoryCache().clearCache()
  }
})
