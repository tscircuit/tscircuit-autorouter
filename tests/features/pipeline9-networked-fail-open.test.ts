import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib"
import type { Pipeline9NetworkedSolveRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  asNetworkedFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

const createMalformedRouteFetch = (
  mutateRoute: (
    route: HighDensityIntraNodeRoute,
    request: Pipeline9NetworkedSolveRequest,
  ) => void,
): typeof fetch =>
  asNetworkedFetch(async (_input, init) => {
    const request = JSON.parse(
      String(init?.body),
    ) as Pipeline9NetworkedSolveRequest
    const route = createNetworkedRoute(request.input.nodeWithPortPoints)
    mutateRoute(route, request)
    return createNetworkedResponse({ status: "solved", routes: [route] })
  })

test("Pipeline9 networked falls back locally for transport and invalid protocol results", async () => {
  const cases: Array<{
    name: string
    requestTimeoutMs?: number
    fetchImpl: typeof fetch
  }> = [
    {
      name: "transport error",
      fetchImpl: asNetworkedFetch(async () => {
        throw new Error("offline")
      }),
    },
    {
      name: "HTTP error",
      fetchImpl: asNetworkedFetch(async () =>
        new Response(JSON.stringify({ ok: false, message: "unavailable" }), {
          status: 503,
        }),
      ),
    },
    {
      name: "version mismatch",
      fetchImpl: asNetworkedFetch(async () =>
        createNetworkedResponse({
          autorouterVersion: "0.0.0-mismatch",
          status: "failed",
          error: "wrong solver version",
        }),
      ),
    },
    {
      name: "malformed solved routes",
      fetchImpl: asNetworkedFetch(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            autorouterVersion: AUTOROUTER_VERSION,
            source: "cache",
            status: "solved",
            routes: [{}],
          }),
          { status: 200 },
        ),
      ),
    },
    {
      name: "foreign route connection",
      fetchImpl: createMalformedRouteFetch((route) => {
        route.connectionName = "foreign_connection"
      }),
    },
    {
      name: "out of range route layer",
      fetchImpl: createMalformedRouteFetch((route, request) => {
        route.route[0]!.z = request.input.layerCount
      }),
    },
    {
      name: "mismatched route trace width",
      fetchImpl: createMalformedRouteFetch((route, request) => {
        route.traceThickness = request.input.traceWidth + 0.05
      }),
    },
    {
      name: "mismatched route via diameter",
      fetchImpl: createMalformedRouteFetch((route, request) => {
        route.viaDiameter = request.input.viaDiameter + 0.05
      }),
    },
    {
      name: "non endpoint route",
      fetchImpl: createMalformedRouteFetch((route) => {
        route.route[0]!.x += 0.01
      }),
    },
    {
      name: "array route metadata",
      fetchImpl: createMalformedRouteFetch((route) => {
        route.route[0]!.toNextSegmentCircuitJsonMetadata = [] as never
      }),
    },
    {
      name: "unknown route metadata field",
      fetchImpl: createMalformedRouteFetch((route) => {
        route.route[0]!.toNextSegmentCircuitJsonMetadata = {
          unknown_id: "unknown",
        } as never
      }),
    },
    {
      name: "non string route metadata value",
      fetchImpl: createMalformedRouteFetch((route) => {
        route.route[0]!.toNextSegmentCircuitJsonMetadata = {
          pcb_port_id: 123,
        } as never
      }),
    },
    {
      name: "timeout",
      requestTimeoutMs: 5,
      fetchImpl: asNetworkedFetch(
        async () => new Promise<Response>(() => {}),
      ),
    },
  ]

  for (const testCase of cases) {
    const node = createNetworkedNode({
      nodeId: `cmn_${testCase.name.replaceAll(" ", "_")}`,
      connectionName: "A",
    })
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      fetchImpl: testCase.fetchImpl,
      requestTimeoutMs: testCase.requestTimeoutMs,
    })

    solver.step()
    expect(solver.pendingEffects, testCase.name).toHaveLength(1)
    await solver.pendingEffects![0]!.promise
    solver.step()

    expect(solver.activeRegularSolver, testCase.name).not.toBeNull()
    expect(solver.failed, testCase.name).toBeFalse()
    expect(solver.stats.remoteTransportFallbacks, testCase.name).toBe(1)
  }

  const validMetadataNode = createNetworkedNode({
    nodeId: "cmn_valid_metadata",
    connectionName: "valid_metadata",
  })
  const validMetadataSolver = createNetworkedHighDensitySolver({
    nodes: [validMetadataNode],
    fetchImpl: asNetworkedFetch(async () => {
      const route = createNetworkedRoute(validMetadataNode)
      route.route[0] = {
        ...route.route[0]!,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: {
          pcb_smtpad_id: "smtpad_1",
          pcb_plated_hole_id: "plated_hole_1",
          pcb_port_id: "port_1",
          pcb_via_id: "via_1",
          source_component_name: "U1",
          source_port_name: "A1",
        },
      }
      return createNetworkedResponse({ status: "solved", routes: [route] })
    }),
  })

  validMetadataSolver.step()
  await validMetadataSolver.pendingEffects![0]!.promise
  validMetadataSolver.step()

  expect(validMetadataSolver.routes).toHaveLength(1)
  expect(validMetadataSolver.stats.remoteTransportFallbacks).toBe(0)
})
