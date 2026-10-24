import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"
import { SelectiveReripTinyHyperGraphSolver, TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import type { DistinctOwnerBlockerHop, DistinctOwnerBlockerSearchResult } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { findCutGuidedOwnerRelease } from "../lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"

type State = { portId: number; nextRegionId: number }
type Hop = DistinctOwnerBlockerHop<State, number, unknown>
type NativeResult = DistinctOwnerBlockerSearchResult<State, number, unknown>
type QueryAccess = {
  state: { currentRouteId?: number; currentRouteNetId?: number }
  findRelaxedBlockerPath: (forbidden?: ReadonlySet<number>) => NativeResult
  getRouteStartPortId: (route: number) => number
  getRouteEndPortId: (route: number) => number
  getStartingNextRegionId: (route: number, port: number) => number | undefined
  getHopId: (port: number, region: number) => number
  getPortOwners: () => ReadonlyMap<number, ReadonlySet<number>>
  getRelaxedSearchHops: (params: {
    state: State; goalPortId: number; routeNetId: number
    portOwners: ReadonlyMap<number, ReadonlySet<number>>
    portResources: Map<number, unknown>; hopTemplatesByRegion: Map<number, Hop[]>
    forbiddenOwnerRouteIds: ReadonlySet<number>; buildRegionTemplates?: boolean
  }) => Hop[]
  createGreedyFinalRouteSolver: (...args: unknown[]) => TinyHyperGraphSolver
}
type Episode = {
  index: number; routeId: number; forbiddenOwnerCount: number
  native: { found: boolean; reason?: string; owners?: number[]; distance?: number; expanded: number; hopVisits: number; materializedHopCount: number }
  candidate: ReturnType<typeof findCutGuidedOwnerRelease<State, number, number, unknown>>
  equalObjective: boolean | null
  graph: { start: number; goalPortId: number; stateCount: number; hopCount: number; sha256: string; capturedFile?: string; boundedStates: unknown[]; nativePathGeometry: unknown[] }
}

// This is a shadow correctness/operation probe. Native results control routing.
// Only owned solver instances are wrapped; no global prototype or dependency edits.
const sample = Number(process.argv[2] ?? 6)
const output = resolve(process.argv[3] ?? `../stage-ownercuts-sample${sample}-episodes.json`)
const maxEpisodes = Number(process.argv[4] ?? 12)
const maxCandidateWork = Number(process.argv[5] ?? 500_000)
const sourceHashes = Object.fromEntries([
  "lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease.ts",
  "lib/solvers/PortPointPathingSolver/tinyhypergraph/buildOwnerCutCondensation.ts",
  "scripts/probeOwnerCutEpisodes.ts",
  "node_modules/tiny-hypergraph/lib/find-distinct-owner-blocker-path.ts",
  "node_modules/tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver.ts",
].map((path): [string, string] => [path, createHash("sha256").update(new Uint8Array(readFileSync(path))).digest("hex")]))
const episodes: Episode[] = []
const installed = new WeakSet<object>()
let nativeQueryCount = 0
let nativeExpandedTotal = 0
let nativeQueryCountAfterCaptureCap = 0
let nativeHopVisitsTotal = 0

function install(solver: TinyHyperGraphSolver): void {
  if (installed.has(solver)) return
  installed.add(solver)
  const instance = solver as unknown as QueryAccess
  if (typeof instance.createGreedyFinalRouteSolver === "function") {
    const factory = instance.createGreedyFinalRouteSolver
    instance.createGreedyFinalRouteSolver = (...args: unknown[]): TinyHyperGraphSolver => {
      const child = factory.apply(solver, args)
      install(child)
      return child
    }
  }
  if (!(solver instanceof SelectiveReripTinyHyperGraphSolver)) return
  let recordingNative = false
  let nativeHopVisits = 0
  let materializedHopCount = 0
  const nativeHopFactory = instance.getRelaxedSearchHops
  instance.getRelaxedSearchHops = (params): Hop[] => {
    const hops = nativeHopFactory.call(solver, params)
    if (recordingNative && !params.buildRegionTemplates) {
      materializedHopCount += hops.length
      // Count native cached-array iterations too. No items, order or values
      // change; this diagnostic runs only in this untimed shadow probe.
      Object.defineProperty(hops, Symbol.iterator, { value: function* (): IterableIterator<Hop> {
        for (let index = 0; index < hops.length; index++) {
          nativeHopVisits++
          yield hops[index]!
        }
      } })
    }
    return hops
  }
  const original = instance.findRelaxedBlockerPath
  instance.findRelaxedBlockerPath = (forbidden = new Set<number>()): NativeResult => {
    nativeQueryCount++
    nativeHopVisits = 0
    materializedHopCount = 0
    recordingNative = true
    const native = original.call(solver, forbidden)
    recordingNative = false
    nativeHopVisitsTotal += nativeHopVisits
    nativeExpandedTotal += native.expandedLabelCount
    if (episodes.length >= maxEpisodes) { nativeQueryCountAfterCaptureCap++; return native }
    const routeId = instance.state.currentRouteId
    const routeNetId = instance.state.currentRouteNetId
    if (routeId === undefined || routeNetId === undefined) throw new Error("Native query lost its route context")
    const startPortId = instance.getRouteStartPortId(routeId)
    const goalPortId = instance.getRouteEndPortId(routeId)
    const startRegionId = instance.getStartingNextRegionId(routeId, startPortId)
    if (startRegionId === undefined) throw new Error("Native query has no directed starting incidence")
    const portOwners = instance.getPortOwners()
    const portResources = new Map<number, unknown>()
    const hopTemplatesByRegion = new Map<number, Hop[]>()
    const graph = new Map<number, { state: State; hops: Hop[] }>()
    const getHops = (state: State): Hop[] => {
      const key = instance.getHopId(state.portId, state.nextRegionId)
      const known = graph.get(key)
      if (known) return known.hops
      const hops = instance.getRelaxedSearchHops({ state, goalPortId, routeNetId, portOwners, portResources, hopTemplatesByRegion, forbiddenOwnerRouteIds: forbidden })
      graph.set(key, { state, hops })
      return hops
    }
    const start = { portId: startPortId, nextRegionId: startRegionId }
    const candidate = findCutGuidedOwnerRelease({ start, getStateKey: (state: State): number => instance.getHopId(state.portId, state.nextRegionId), isGoal: (state: State): boolean => state.portId === goalPortId, getHops, maxWorkUnits: maxCandidateWork })
    const a = candidate.result
    const equalObjective = native.found && a.found ? native.owners.size === a.owners.size && native.distance === a.distance : native.found === a.found && !native.found && !a.found && native.reason === a.reason ? true : null
    if (native.found && a.found && !equalObjective) throw new Error(`Owner-cut objective mismatch on native episode${nativeQueryCount}`)
    const serializedGraph = { start: instance.getHopId(start.portId, start.nextRegionId), goalPortId, states: [...graph].map(([key, value]) => ({ key, state: value.state, hops: value.hops.map((hop) => ({ to: instance.getHopId(hop.state.portId, hop.state.nextRegionId), state: hop.state, distance: hop.distance, owners: [...(hop.owners ?? [])] })) })) }
    const bytes = new TextEncoder().encode(JSON.stringify(serializedGraph))
    let capturedFile: string | undefined
    if (episodes.length < 2 && bytes.length <= 64 * 1024 * 1024) {
      capturedFile = `${output}.episode${nativeQueryCount}.json.gz`
      writeFileSync(capturedFile, new Uint8Array(gzipSync(bytes)))
    }
    episodes.push({
      index: nativeQueryCount, routeId, forbiddenOwnerCount: forbidden.size,
      native: { found: native.found, expanded: native.expandedLabelCount, hopVisits: nativeHopVisits, materializedHopCount, ...(native.found ? { owners: [...native.owners], distance: native.distance } : { reason: native.reason }) },
      candidate, equalObjective,
      graph: { start: serializedGraph.start, goalPortId, stateCount: graph.size, hopCount: serializedGraph.states.reduce((sum, state): number => sum + state.hops.length, 0), sha256: createHash("sha256").update(bytes).digest("hex"), capturedFile, boundedStates: serializedGraph.states.slice(0, 8).map((state) => ({ ...state, hops: state.hops.slice(0, 8) })), nativePathGeometry: native.found ? native.states.map((state) => ({ ...state, x: solver.topology.portX[state.portId], y: solver.topology.portY[state.portId] })) : [] },
    })
    console.log(JSON.stringify({ episode: nativeQueryCount, nativeLabels: native.expandedLabelCount, nativeHopVisits, candidateFound: a.found, candidateWork: candidate.work.workUnits, cuts: candidate.work.learnedCuts, masterStates: candidate.work.masterExpandedStates }))
    return native
  }
}

const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
const stopPhase = "uniformPortDistributionSolver"
while (!pipeline.solved && !pipeline.failed) {
  if (pipeline.pipelineDef[pipeline.currentPipelineStepIndex]?.solverName === stopPhase) break
  const stage = pipeline.portPointPathingSolver
  if (stage?.activeSubSolver instanceof TinyHyperGraphSolver) install(stage.activeSubSolver)
  const inner = stage as unknown as { tinyPipelineSolver?: { activeSubSolver?: object; getSolver?: (name: string) => object | undefined } } | undefined
  for (const value of [inner?.tinyPipelineSolver?.activeSubSolver, inner?.tinyPipelineSolver?.getSolver?.("solveGraph")]) {
    if (value instanceof TinyHyperGraphSolver) install(value)
  }
  pipeline.step()
}
const port = pipeline.portPointPathingSolver
const record = { base: "b9d32a05c76af701d518f6a78a3114e68addd144", sourceHashes, scope: "Native controlled port phase shadow probe; no elapsed-time benchmark. Native decisions preserved. Captured graph may be partial when candidate stops or is capped; missing adjacency is unknown, never an empty list.", sample, maxEpisodes, maxCandidateWork, solvedPort: port?.solved ?? false, pipelineFailed: pipeline.failed, pipelineError: pipeline.error, nativeQueryCount, nativeExpandedTotal, nativeHopVisitsTotal, nativeQueryCountAfterCaptureCap, capturedNativeExpanded: episodes.reduce((sum, episode): number => sum + episode.native.expanded, 0), episodes }
writeFileSync(output, JSON.stringify(record, (_key, value): unknown => value instanceof Set ? [...value] : value, 2) + "\n")
console.log(JSON.stringify({ output, solvedPort: record.solvedPort, nativeQueryCount, captured: episodes.length, capturedNativeExpanded: record.capturedNativeExpanded, candidateKnown: episodes.filter((episode): boolean => episode.candidate.result.found || episode.candidate.result.reason === "no_path").length, candidateCapped: episodes.filter((episode): boolean => !episode.candidate.result.found && episode.candidate.result.reason === "expansion_limit").length }))
