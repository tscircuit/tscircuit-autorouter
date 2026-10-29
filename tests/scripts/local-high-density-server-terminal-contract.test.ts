import { expect, test } from "bun:test"
import { createLocalHighDensityServer } from "../../scripts/benchmark/createLocalHighDensityServer"
import type { LocalHighDensityObject } from "../../scripts/benchmark/localHighDensityProtocol"

type TerminalCase = {
  name: string
  input: LocalHighDensityObject
  output: LocalHighDensityObject
  valid: boolean
}

test("local server caches terminal helper results while malformed metadata faults and geometry stays untouched", async (): Promise<void> => {
  const ordinary: LocalHighDensityObject = {
    solvePolicy: "ordinary_then_regional_without_fixed_copper_v1",
    enableRegionalFallback: false,
  }
  const regional: LocalHighDensityObject = {
    ...ordinary,
    enableRegionalFallback: true,
  }
  const repair: LocalHighDensityObject = {
    solvePolicy: "high_density_repair_v1",
  }
  const onePoint = {
    connectionName: "trace",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }],
    vias: [],
    regionId: "node",
  }
  const solved: LocalHighDensityObject = {
    status: "solved",
    solutionStage: "ordinary",
    routes: [onePoint],
  }
  const regionalSolved: LocalHighDensityObject = {
    status: "solved",
    solutionStage: "regional-fallback",
    ordinaryFailure: "ordinary routing failed",
    routes: [onePoint],
  }
  const repaired: LocalHighDensityObject = {
    status: "solved",
    solutionStage: "repair",
    repairedRoutes: [
      { capacityMeshNodeId: "node", route: [{ x: 0, y: 0, z: 0 }] },
    ],
    clearanceStats: {
      nodeClearanceInitialConflictCount: 2,
      nodeClearanceFinalConflictCount: 0,
      nodeClearanceCandidateCount: 3,
    },
  }
  const fixtures: TerminalCase[] = [
    {
      name: "one-point geometry",
      input: ordinary,
      output: { ...solved, forceImproved: true },
      valid: true,
    },
    {
      name: "coverage gap geometry",
      input: ordinary,
      output: { ...solved, routes: [] },
      valid: true,
    },
    {
      name: "regional solved",
      input: regional,
      output: regionalSolved,
      valid: true,
    },
    {
      name: "ordinary failed",
      input: ordinary,
      output: {
        status: "failed",
        solutionStage: "ordinary",
        error: "ordinary failure",
      },
      valid: true,
    },
    {
      name: "regional failed",
      input: regional,
      output: {
        status: "failed",
        solutionStage: "regional-fallback",
        ordinaryFailure: "ordinary failure",
        error: "regional failure",
      },
      valid: true,
    },
    {
      name: "repair solved metadata",
      input: repair,
      output: repaired,
      valid: true,
    },
    {
      name: "repair failed",
      input: repair,
      output: {
        status: "failed",
        solutionStage: "repair",
        error: "repair failure",
      },
      valid: true,
    },
    {
      name: "generic injected repair policy",
      input: { solvePolicy: "repair_v1" },
      output: repaired,
      valid: true,
    },
    {
      name: "unknown terminal stage",
      input: ordinary,
      output: { ...solved, solutionStage: "other" },
      valid: false,
    },
    {
      name: "missing terminal stage",
      input: ordinary,
      output: { status: "solved", routes: [] },
      valid: false,
    },
    {
      name: "unknown status",
      input: ordinary,
      output: { ...solved, status: "pending" },
      valid: false,
    },
    {
      name: "missing solved routes",
      input: ordinary,
      output: { status: "solved", solutionStage: "ordinary" },
      valid: false,
    },
    {
      name: "nonarray solved routes",
      input: ordinary,
      output: { ...solved, routes: {} },
      valid: false,
    },
    {
      name: "missing repaired routes",
      input: repair,
      output: { status: "solved", solutionStage: "repair", routes: [] },
      valid: false,
    },
    {
      name: "nonarray repaired routes",
      input: repair,
      output: { ...repaired, repairedRoutes: {} },
      valid: false,
    },
    {
      name: "ordinary result contains ordinaryFailure",
      input: ordinary,
      output: { ...solved, ordinaryFailure: "failure" },
      valid: false,
    },
    {
      name: "ordinary result contains null ordinaryFailure",
      input: ordinary,
      output: { ...solved, ordinaryFailure: null },
      valid: false,
    },
    {
      name: "disabled regional result",
      input: ordinary,
      output: regionalSolved,
      valid: false,
    },
    {
      name: "missing regional ordinaryFailure",
      input: regional,
      output: {
        status: "solved",
        solutionStage: "regional-fallback",
        routes: [],
      },
      valid: false,
    },
    {
      name: "empty regional ordinaryFailure",
      input: regional,
      output: { ...regionalSolved, ordinaryFailure: " " },
      valid: false,
    },
    {
      name: "nonstring regional ordinaryFailure",
      input: regional,
      output: { ...regionalSolved, ordinaryFailure: 1 },
      valid: false,
    },
    {
      name: "missing failure error",
      input: ordinary,
      output: { status: "failed", solutionStage: "ordinary" },
      valid: false,
    },
    {
      name: "empty failure error",
      input: ordinary,
      output: { status: "failed", solutionStage: "ordinary", error: " " },
      valid: false,
    },
    {
      name: "nonstring failure error",
      input: ordinary,
      output: { status: "failed", solutionStage: "ordinary", error: 1 },
      valid: false,
    },
    {
      name: "ordinary failure with unfinished regional policy",
      input: regional,
      output: {
        status: "failed",
        solutionStage: "ordinary",
        error: "ordinary failure",
      },
      valid: false,
    },
    {
      name: "ordinary helper returned repair stage",
      input: ordinary,
      output: repaired,
      valid: false,
    },
    {
      name: "repair helper returned ordinary stage",
      input: repair,
      output: solved,
      valid: false,
    },
  ]
  for (const field of [
    "ok",
    "source",
    "autorouterVersion",
    "cacheVersion",
    "requestId",
  ]) {
    fixtures.push({
      name: `server-owned ${field}`,
      input: ordinary,
      output: { ...solved, [field]: "spoofed" },
      valid: false,
    })
  }
  for (const fixture of fixtures) {
    const faults: Error[] = []
    let solveCount = 0
    const handler = createLocalHighDensityServer({
      autorouterVersion: "0.0.968",
      solve: (input: LocalHighDensityObject): LocalHighDensityObject => {
        solveCount++
        expect(input).toEqual(fixture.input)
        expect(solveCount).toBe(1)
        return fixture.output
      },
      onFault: faults.push.bind(faults),
    })
    const identity = {
      autorouterVersion: "0.0.968",
      cacheVersion: fixture.name,
    }
    const response = await handler.fetch(
      new Request("http://127.0.0.1/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...identity, input: fixture.input }),
      }),
    )
    expect(response.status).toBe(fixture.valid ? 200 : 500)
    const body = await response.json()
    if (fixture.valid) {
      expect(body).toEqual({
        ok: true,
        ...identity,
        source: "solver",
        ...fixture.output,
      })
      expect(faults).toEqual([])
    } else {
      expect(body).toEqual({ ok: false, message: expect.any(String) })
      expect(faults).toHaveLength(1)
      expect(faults[0]).toBeInstanceOf(TypeError)
    }
    expect(handler.stats.jobsComputed).toBe(fixture.valid ? 1 : 0)
    const lookup = await handler.fetch(
      new Request("http://127.0.0.1/solve-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...identity,
          items: [{ requestId: "cached-job", input: fixture.input }],
        }),
      }),
    )
    const cached = JSON.parse((await lookup.text()).trim())
    if (fixture.valid) {
      expect(cached).toEqual({
        ok: true,
        ...identity,
        requestId: "cached-job",
        source: "cache",
        ...fixture.output,
      })
    } else {
      expect(cached).toMatchObject({
        ok: false,
        ...identity,
        requestId: "cached-job",
        code: "CACHE_MISS",
      })
    }
    expect(solveCount).toBe(1)
  }
})
