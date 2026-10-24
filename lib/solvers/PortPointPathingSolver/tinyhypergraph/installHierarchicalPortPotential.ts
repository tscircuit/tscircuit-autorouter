import { TinyHyperGraphSolver, type TinyHyperGraphTopology, type TinyHyperGraphSolverOptions } from 'tiny-hypergraph/lib/core'
import { PartialContractionMetric, type MetricEdge } from './PartialContractionMetric'

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type Host = Omit<TinyHyperGraphSolver, never> & {
  getRouteEndPortId(route: number): number
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}
export type HierarchicalPortDiagnostics = {
  maxAdditionalWorkUnits: number; installedSolvers: number; topologyBuilds: number; vertices: number; baseEdges: number
  fillEdges: number; eliminatedVertices: number; fillTriangles: number; landmarkFields: number
  workUnits: number; setupWorkUnits: number; heuristicQueries: number; strengthenedQueries: number
  goalChanges: number; goalBinReads: number; budgetExhaustions: number; nativeIterations: number
  heuristicMemoHits: number; evaluatedPortBounds: number; memoryLimitHits: number
}
type Model = { metric: PartialContractionMetric; portBins: number[][]; regionBins: number[][]; fields: Float64Array[] }
// A separate pipeline-global allowance bounds ALL additional compilation/query
// work, including recursive children. Existing native iteration caps are unchanged.
// This is explicit extra preprocessing effort, not an equal-CPU-budget claim.
const EXTRA_WORK_LIMIT = 50_000_000
class HierarchyBudgetError extends Error {}

export function createHierarchicalPortController(maxAdditionalWorkUnits = EXTRA_WORK_LIMIT): {
  diagnostics: HierarchicalPortDiagnostics; install: (solver: TinyHyperGraphSolver) => void
} {
  if (!Number.isSafeInteger(maxAdditionalWorkUnits) || maxAdditionalWorkUnits < 0 || maxAdditionalWorkUnits > EXTRA_WORK_LIMIT) throw new Error("Invalid hierarchical work limit")
  const diagnostics: HierarchicalPortDiagnostics = {
    maxAdditionalWorkUnits, installedSolvers: 0, topologyBuilds: 0, vertices: 0, baseEdges: 0,
    fillEdges: 0, eliminatedVertices: 0, fillTriangles: 0, landmarkFields: 0,
    workUnits: 0, setupWorkUnits: 0, heuristicQueries: 0, strengthenedQueries: 0,
    goalChanges: 0, goalBinReads: 0, budgetExhaustions: 0, nativeIterations: 0,
    heuristicMemoHits: 0, evaluatedPortBounds: 0, memoryLimitHits: 0,
  }
  const models = new WeakMap<object, Model>(), installed = new WeakSet<object>()
  let exhausted = false
  const charge = (units = 1): void => {
    if (!Number.isSafeInteger(units) || units < 0) throw new Error('Invalid hierarchy work charge')
    if (diagnostics.workUnits + units > maxAdditionalWorkUnits) {
      exhausted = true
      diagnostics.budgetExhaustions++
      throw new HierarchyBudgetError('UNKNOWN: hierarchical port preprocessing/query work budget exhausted')
    }
    diagnostics.workUnits += units
  }
  const buildUnchecked = (topology: TinyHyperGraphTopology): Model => {
    if (topology.portCount > 100_000 || topology.regionCount > 100_000) {
      exhausted = true; diagnostics.memoryLimitHits++
      throw new HierarchyBudgetError("UNKNOWN: hierarchical port topology memory limit")
    }
    diagnostics.topologyBuilds++
    charge(topology.portCount + topology.regionCount)
    const portBins = Array.from({ length: topology.portCount }, (): number[] => [])
    const regionBins = Array.from({ length: topology.regionCount }, (): number[] => [])
    const boxes: Bounds[] = [], edges: MetricEdge[] = []
    for (let region = 0; region < topology.regionCount; region++) {
      const ports = [...topology.regionIncidentPorts[region]!]
      charge(ports.length)
      ports.sort((a, b): number => {
        charge()
        const angleA = Math.atan2(topology.portY[a]! - topology.regionCenterY[region]!, topology.portX[a]! - topology.regionCenterX[region]!)
        const angleB = Math.atan2(topology.portY[b]! - topology.regionCenterY[region]!, topology.portX[b]! - topology.regionCenterX[region]!)
        return angleA - angleB || a - b
      })
      const count = Math.min(4, ports.length)
      for (let bin = 0; bin < count; bin++) {
        charge()
        const vertex = boxes.length
        const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        boxes.push(box)
        regionBins[region]!.push(vertex)
        for (let i = Math.floor(bin * ports.length / count); i < Math.floor((bin + 1) * ports.length / count); i++) {
          charge()
          const port = ports[i]!, x = topology.portX[port]!, y = topology.portY[port]!
          if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Nonfinite hierarchy port coordinate')
          box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x)
          box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y)
          portBins[port]!.push(vertex)
        }
      }
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        charge()
        const from = regionBins[region]![i]!, to = regionBins[region]![j]!, a = boxes[from]!, b = boxes[to]!
        edges.push({ from, to, weight: Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY)) })
      }
    }
    for (const bins of portBins) for (let i = 0; i < bins.length; i++) for (let j = i + 1; j < bins.length; j++) {
      charge()
      edges.push({ from: bins[i]!, to: bins[j]!, weight: 0 })
    }
    const metric = new PartialContractionMetric(boxes.length, edges, charge)
    diagnostics.vertices += boxes.length; diagnostics.baseEdges += metric.baseEdgeIds.length
    diagnostics.fillEdges += metric.edges.length - metric.baseEdgeIds.length
    diagnostics.eliminatedVertices += metric.order.length; diagnostics.fillTriangles += metric.triangles.length
    const fields: Float64Array[] = []
    if (boxes.length) {
      // Diameter endpoints in the relaxed component avoid a one-sided landmark.
      const first = metric.distances([0])
      let farthest = 0
      for (let i = 0; i < first.length; i++) { charge(); if (Number.isFinite(first[i]) && first[i]! > first[farthest]!) farthest = i }
      fields.push(metric.distances([farthest]))
      let opposite = farthest
      for (let i = 0; i < first.length; i++) { charge(); if (Number.isFinite(fields[0]![i]) && fields[0]![i]! > fields[0]![opposite]!) opposite = i }
      fields.push(metric.distances([opposite]))
    }
    diagnostics.landmarkFields += fields.length
    return { metric, portBins, regionBins, fields }
  }
  const build = (topology: TinyHyperGraphTopology): Model => {
    const before = diagnostics.workUnits
    try {
      return buildUnchecked(topology)
    } finally {
      diagnostics.setupWorkUnits += diagnostics.workUnits - before
    }
  }
  const install = (solver: TinyHyperGraphSolver): void => {
    if (installed.has(solver)) return
    installed.add(solver)
    diagnostics.installedSolvers++
    const host = solver as unknown as Host
    const nativeStep = host._step, nativeH = host.computeH
    let model: Model | undefined, goal = -1, goalRanges: Array<readonly [number, number]> = []
    charge(host.topology.portCount * 2)
    const memoGoal = new Int32Array(host.topology.portCount).fill(-1)
    const memoBound = new Float64Array(host.topology.portCount)
    host.computeH = function(port: number): number {
      const original = nativeH.call(this, port)
      const route = host.state.currentRouteId
      if (route === undefined) return original
      charge()
      diagnostics.heuristicQueries++
      const end = host.getRouteEndPortId(route)
      if (memoGoal[port] === end) {
        diagnostics.heuristicMemoHits++
        return Math.max(original, memoBound[port]!)
      }
      diagnostics.evaluatedPortBounds++
      if (end !== goal) {
        goal = end; diagnostics.goalChanges++
        const goalBins = new Set<number>()
        for (const region of host.topology.incidentPortRegion[end]!) for (const bin of model!.regionBins[region]!) {
          charge(); diagnostics.goalBinReads++; goalBins.add(bin)
        }
        goalRanges = model!.fields.map((field): readonly [number, number] => {
          let low = Infinity, high = -Infinity
          for (const bin of goalBins) { charge(); low = Math.min(low, field[bin]!); high = Math.max(high, field[bin]!) }
          return [low, high]
        })
      }
      // A port-only native heuristic forgets the entry direction. Taking the
      // minimum across all its incident bins is an additional relaxation.
      let bound = Infinity
      for (const bin of model!.portBins[port]!) {
        let value = 0
        for (let i = 0; i < model!.fields.length; i++) {
          charge()
          const at = model!.fields[i]![bin]!, [low, high] = goalRanges[i]!
          if (Number.isFinite(at) && Number.isFinite(low) && Number.isFinite(high)) value = Math.max(value, low - at, at - high)
        }
        bound = Math.min(bound, value)
      }
      const proposed = Number.isFinite(bound) ? bound * host.DISTANCE_TO_COST : 0
      memoGoal[port] = end; memoBound[port] = proposed
      if (proposed > original) diagnostics.strengthenedQueries++
      // Native G normally omits geometric distance. This changes guidance,
      // with no admissibility/optimality or native route parity claim.
      return Math.max(original, proposed)
    }
    const createChild = host.createGreedyFinalRouteSolver
    host.createGreedyFinalRouteSolver = function(options, attempt): TinyHyperGraphSolver {
      const child = createChild.call(this, options, attempt)
      install(child)
      return child
    }
    host._step = function(): void {
      try {
        if (exhausted) throw new HierarchyBudgetError("UNKNOWN: hierarchical port work budget already exhausted")
        model ??= models.get(host.topology)
        if (!model) { model = build(host.topology); models.set(host.topology, model) }
        diagnostics.nativeIterations++
        nativeStep.call(this)
        if (exhausted) throw new HierarchyBudgetError("UNKNOWN: hierarchical child exhausted shared work budget")
      } catch (error) {
        if (!(error instanceof HierarchyBudgetError)) throw error
        host.failed = true; host.solved = false; host.error = error.message
      }
    }
  }
  return { diagnostics, install }
}
