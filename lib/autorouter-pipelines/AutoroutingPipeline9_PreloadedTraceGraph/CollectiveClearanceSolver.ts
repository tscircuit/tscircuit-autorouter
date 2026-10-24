import { RelaxTraceClearanceSolver, getRepairViaGeometry } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { segmentToSegmentMinDistance, pointToSegmentClosestPoint } from "@tscircuit/math-utils"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { HalfspaceProjectionSolver, type LinearHalfspace } from "lib/solvers/HalfspaceProjectionSolver"
import { getOppositeRowCertificate, type OppositeRowCheckStats } from "lib/solvers/getOppositeRowCertificate"

type Input = ConstructorParameters<typeof RelaxTraceClearanceSolver>[0]
type Routes = Input["routes"]
type Vertex = {
  x: number
  y: number
  original: { x: number; y: number }
  locked: boolean
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}
type Segment = { a: Vertex; b: Vertex; radius: number; via: boolean }
type PreparedState = {
  phase: "geometry" | "pairs" | "obstacles" | "sweeps" | "finalize"
  vertices: Map<string, Vertex>
  segments: Segment[]
  pairs: { a: Segment; b: Segment }[]
  padContacts: { segment: Segment; corners: { x: number; y: number }[]; required: number }[]
}
type Point = { x: number; y: number }
type Normal = { x: number; y: number }
type Family = { id: number; vertices: number[]; alternatives: LinearHalfspace[][] }
type Component = { vertices: number[]; families: Family[] }
type ActiveComponent = {
  component: Component
  variableMap: Map<number, number>
  pending: number[][]
  seen: Set<string>
  branches: number
  choices?: number[]
  solver?: HalfspaceProjectionSolver
}

/**
 * A bounded fixed-topology separating-normal convex model. Native repair04 preparation
 * and finalization are retained verbatim through its pinned runtime state.
 * Only its 256 projection sweeps are replaced. An exhausted model produces
 * explicit unknown components and retains their original coordinates; it
 * never invokes projection as a fallback or reports physical infeasibility.
 */
export class CollectiveClearanceSolver extends BaseSolver {
  readonly preparation: RelaxTraceClearanceSolver
  private prepared?: PreparedState
  private vertices: Vertex[] = []
  private components: Component[] = []
  private componentIndex = 0
  private active?: ActiveComponent
  private output?: Routes
  private phase: "prepare" | "components" | "solve" | "verify" | "finalize" = "prepare"
  private activeFamilyKeys = new Set<string>()
  private verificationIndex = 0
  private verificationAdded = 0
  private separationRound = 0
  private lowerBounds = new Float64Array(0)
  private upperBounds = new Float64Array(0)
  private drillsAugmented = false
  private totalChecks = 0
  private readonly drillSeparation: number
  readonly limits: { branches: number; vertices: number; constraintChecks: number }

  constructor(input: Input, limits = { branches: 32, vertices: 128, constraintChecks: 2_000_000 }) {
    super()
    for (const limit of Object.values(limits)) {
      if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new Error("Collective clearance limits must be finite nonnegative integers")
      }
    }
    this.limits = limits
    const srj = input.srj as typeof input.srj & { minViaHoleEdgeToViaHoleEdgeClearance?: number }
    this.drillSeparation = getViaDimensions(srj).holeDiameter + Math.max(0.1, srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0)
    // Validate physical site identity before sharing native prepared vertices.
    // Native locks preserve terminals, junctions and through-obstacle data.
    let viaSites = 0
    for (const route of input.routes) viaSites += getRepairViaGeometry(route, input.srj.layerCount).length
    this.preparation = new RelaxTraceClearanceSolver(input)
    this.MAX_ITERATIONS = this.preparation.MAX_ITERATIONS + 4
    this.stats = {
      preparedSteps: 0, families: 0, components: 0, solvedComponents: 0,
      unknownComponents: 0, movedVertices: 0, branches: 0, unknownChoiceAssignments: 0,
      residualBranches: 0, constraintChecks: 0, skippedLockedFamilies: 0,
      rowUpdates: 0, residualChecks: 0, witnessChecks: 0,
      branchVariableInstances: 0, maxBranchVariables: 0, maxBranchRows: 0,
      generatedNormalChoices: 0, selectedObliqueRows: 0, changedFamilyChoices: 0,
      projectionSweeps: 0, workLimitedAssignments: 0, sweepLimitedAssignments: 0,
      numericalAssignments: 0, constantConstraintAssignments: 0,
      certifiedChoiceContradictions: 0, certifiedFamilyReferences: 0, boundedHardContradictions: 0, certifiedBranchesGenerated: 0,
      preprocessingRows: 0, canonicalizedTerms: 0, hashProbes: 0, hashKeyCharacters: 0,
      canonicalSortComparisons: 0, exactRowChecks: 0, proofTermReads: 0,
      exactTermComparisons: 0, proofSortComparisons: 0, certificateRechecks: 0,
      nativeProjectionSweeps: 0, retainedOriginalVertices: 0,
      generatedConstraintEdges: 0, branchConstraintEdges: 0, discardedBranchChoices: 0,
      verificationPairChecks: 0, verificationPadChecks: 0, separationRounds: 0,
      initialViolations: 0, activatedFamilies: 0, rolledBackUncertainCandidate: 0,
      prunedSideChoices: 0, emptySideDomains: 0, unresolvedFamilies: 0, validatedViaSites: viaSites,
      addedOwnerIndependentDrillPairs: 0, drillPairExaminations: 0,
    }
  }

  private reserveCollectiveIterations(state: PreparedState): void {
    // The native child can legitimately reserve more than 100k preparation
    // steps. Once geometry is fixed, reserve a finite scheduler allowance for
    // this model; its physical/branch/work caps are unchanged. Do not renew
    // this deadline during model execution, which would hide a stuck state.
    const vertices = state.vertices.size
    const possibleDrillPairs = vertices * (vertices - 1) / 2
    const contacts = state.pairs.length + state.padContacts.length + possibleDrillPairs
    const componentSteps = 4 + 132 * this.limits.branches
    // Each executed branch can append at most 128 pending choices. Each child
    // has at most one final partial batch plus one result/transition step.
    const rounds = 4 * (vertices * componentSteps + Math.ceil(contacts / 4096) + 4)
    const preprocessing = 4 * Math.ceil(this.limits.branches * (8 * contacts + 4 * vertices) / 4096)
    const checks = Math.ceil(this.limits.constraintChecks / 4096)
    const maximum = this.iterations + rounds + preprocessing + checks + 4
    if (!Number.isSafeInteger(maximum)) {
      throw new Error("Collective scheduler reservation exceeds finite integer capacity")
    }
    this.MAX_ITERATIONS = Math.max(this.MAX_ITERATIONS, maximum)
  }

  private getPreparedState(): PreparedState {
    // repair04 is pinned to 4273e9455084b7b35ebc860ebe4483b9d19692ea.
    // These are TypeScript-private fields, not a promised upstream API.
    // Fail loudly on an incompatible dependency instead of guessing geometry.
    const state = this.preparation as unknown as PreparedState
    if (
      !(state.vertices instanceof Map) || !Array.isArray(state.pairs) || !Array.isArray(state.segments) ||
      !Array.isArray(state.padContacts) ||
      !["geometry", "pairs", "obstacles", "sweeps", "finalize"].includes(state.phase)
    ) throw new Error("Pinned repair04 preparation contract changed")
    return state
  }

  private prepareComponents(): void {
    const state = this.prepared!
    this.vertices = [...state.vertices.values()]
    const ids = new Map(this.vertices.map((vertex, index): [Vertex, number] => [vertex, index]))
    this.lowerBounds = new Float64Array(this.vertices.length * 2 + 1)
    this.upperBounds = new Float64Array(this.vertices.length * 2 + 1)
    for (let index = 0; index < this.vertices.length; index++) {
      const vertex = this.vertices[index]!
      if (vertex.locked) continue
      for (const axis of ["x", "y"] as const) {
        const variable = index * 2 + (axis === "x" ? 1 : 2)
        this.lowerBounds[variable] = Math.max(-0.25, vertex.bounds[axis === "x" ? "minX" : "minY"] - vertex.original[axis])
        this.upperBounds[variable] = Math.min(0.25, vertex.bounds[axis === "x" ? "maxX" : "maxY"] - vertex.original[axis])
      }
    }
    if (!this.drillsAugmented) {
      const siteMap = new Map<Vertex, Segment>()
      for (const segment of state.segments) {
        if (!segment.via) continue
        const previous = siteMap.get(segment.a)
        if (!previous || previous.radius < segment.radius) siteMap.set(segment.a, segment)
      }
      const sites = [...siteMap.values()]
      const existing = new Set(state.pairs.filter((pair): boolean => pair.a.via && pair.b.via)
        .map((pair): string => [ids.get(pair.a.a)!, ids.get(pair.b.a)!].sort((a, b): number => a - b).join(":")))
      for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++) {
        this.stats.drillPairExaminations = Number(this.stats.drillPairExaminations) + 1
        const pair = { a: sites[a]!, b: sites[b]! }
        const key = [ids.get(pair.a.a)!, ids.get(pair.b.a)!].sort((x, y): number => x - y).join(":")
        if (existing.has(key)) continue
        const reach = this.requiredForPair(pair) + Math.SQRT2 * 0.5
        if (Math.hypot(pair.a.a.x - pair.b.a.x, pair.a.a.y - pair.b.a.y) > reach) continue
        state.pairs.push(pair)
        this.stats.addedOwnerIndependentDrillPairs = Number(this.stats.addedOwnerIndependentDrillPairs) + 1
      }
      this.drillsAugmented = true
    }
    const parents = this.vertices.map((_, index): number => index)
    const find = (index: number): number => {
      let root = index
      while (parents[root] !== root) root = parents[root]!
      while (parents[index] !== index) {
        const previous = parents[index]!
        parents[index] = root
        index = previous
      }
      return root
    }
    const families: Family[] = []
    for (let pairIndex = 0; pairIndex < state.pairs.length; pairIndex++) {
      const pair = state.pairs[pairIndex]!
      const key = `pair:${pairIndex}`
      if (!this.activeFamilyKeys.has(key) && !this.pairViolated(pair)) continue
      this.activeFamilyKeys.add(key)
      const required = this.requiredForPair(pair) + 1e-6
      const points = [pair.a.a, pair.a.b, pair.b.a, pair.b.b]
      const alternatives: { edges: LinearHalfspace[]; slack: number }[] = []
      for (const normal of this.separatingNormals(pair.a, pair.b)) {
        const edges: LinearHalfspace[] = []
        let slack = Infinity
        for (const a of [pair.a.a, pair.a.b]) for (const b of [pair.b.a, pair.b.b]) {
          const maximum = normal.x * (b.original.x - a.original.x) + normal.y * (b.original.y - a.original.y) - required
          slack = Math.min(slack, maximum)
          edges.push({ terms: this.displacementTerms([{ point: a, sign: 1 }, { point: b, sign: -1 }], normal, ids), maximum })
        }
        alternatives.push({ edges, slack })
      }
      this.addFamily(points, alternatives, ids, families, parents, find)
    }
    for (let padIndex = 0; padIndex < state.padContacts.length; padIndex++) {
      const pad = state.padContacts[padIndex]!
      const key = `pad:${padIndex}`
      if (!this.activeFamilyKeys.has(key) && !this.padViolated(pad)) continue
      this.activeFamilyKeys.add(key)
      const points = [pad.segment.a, pad.segment.b]
      const required = pad.required + 1e-6
      const alternatives: { edges: LinearHalfspace[]; slack: number }[] = []
      const normals = new Map<string, Normal>()
      for (let index = 0; index < pad.corners.length; index++) {
        const edge = { a: pad.corners[index]!, b: pad.corners[(index + 1) % pad.corners.length]! }
        for (const normal of this.separatingNormals(pad.segment, edge)) {
          normals.set(`${normal.x.toPrecision(10)}:${normal.y.toPrecision(10)}`, normal)
        }
      }
      for (const normal of normals.values()) {
        const edges: LinearHalfspace[] = []
        let slack = Infinity
        for (const point of points) for (const corner of pad.corners) {
          const maximum = normal.x * (point.original.x - corner.x) + normal.y * (point.original.y - corner.y) - required
          slack = Math.min(slack, maximum)
          edges.push({ terms: this.displacementTerms([{ point, sign: -1 }], normal, ids), maximum })
        }
        alternatives.push({ edges, slack })
      }
      this.addFamily(points, alternatives, ids, families, parents, find)
    }
    const components = new Map<number, Component>()
    for (const family of families) {
      const root = find(family.vertices[0]!)
      let component = components.get(root)
      if (!component) {
        component = { vertices: [], families: [] }
        components.set(root, component)
      }
      component.families.push(family)
    }
    for (let index = 0; index < this.vertices.length; index++) {
      if (this.vertices[index]!.locked) continue
      components.get(find(index))?.vertices.push(index)
    }
    this.components = [...components.values()]
    this.componentIndex = 0
    this.active = undefined
    if (this.separationRound === 0) this.stats.initialViolations = this.activeFamilyKeys.size
    this.stats.activatedFamilies = this.activeFamilyKeys.size
    this.stats.components = this.components.length
    this.stats.families = families.length
    this.stats.generatedConstraintEdges = Number(this.stats.generatedConstraintEdges) + families.reduce((sum, family): number =>
      sum + family.alternatives.reduce((total, edges): number => total + edges.length, 0), 0)
    this.stats.preparedPairCount = Number(this.preparation.stats.preparedPairCount)
    this.stats.preparedPadContactCount = state.padContacts.length
    this.phase = "solve"
  }

  private separatingNormals(a: { a: Point; b: Point }, b: { a: Point; b: Point }): Normal[] {
    const vectors: Normal[] = [
      { x: 1, y: 0 }, { x: 0, y: 1 },
      { x: a.a.y - a.b.y, y: a.b.x - a.a.x },
      { x: b.a.y - b.b.y, y: b.b.x - b.a.x },
    ]
    for (const point of [a.a, a.b]) {
      const closest = pointToSegmentClosestPoint(point, b.a, b.b)
      vectors.push({ x: closest.x - point.x, y: closest.y - point.y })
    }
    for (const point of [b.a, b.b]) {
      const closest = pointToSegmentClosestPoint(point, a.a, a.b)
      vectors.push({ x: point.x - closest.x, y: point.y - closest.y })
    }
    const normals = new Map<string, Normal>()
    for (const vector of vectors) {
      const length = Math.hypot(vector.x, vector.y)
      if (!(length > 1e-12) || !Number.isFinite(length)) continue
      for (const sign of [1, -1]) {
        const normal = { x: sign * vector.x / length, y: sign * vector.y / length }
        // Deduplication only removes nearly identical finite choices. Every
        // retained normal still gets full endpoint half-space constraints.
        normals.set(`${normal.x.toPrecision(10)}:${normal.y.toPrecision(10)}`, normal)
      }
    }
    return [...normals.values()]
  }

  private displacementTerms(
    points: { point: Vertex; sign: number }[], normal: Normal, ids: Map<Vertex, number>,
  ): LinearHalfspace["terms"] {
    const terms = new Map<number, number>()
    for (const { point, sign } of points) {
      for (const axis of ["x", "y"] as const) {
        const variable = this.variableId(ids.get(point)!, axis)
        if (variable === 0) continue
        terms.set(variable, (terms.get(variable) ?? 0) + sign * normal[axis])
      }
    }
    return [...terms].filter(([, coefficient]): boolean => coefficient !== 0)
      .map(([variable, coefficient]): LinearHalfspace["terms"][number] => ({ variable, coefficient }))
  }

  private variableId(index: number, axis: "x" | "y"): number {
    if (this.vertices[index]!.locked) {
      return 0
    }
    const offset = axis === "x" ? 1 : 2
    // Zero is the exact no-displacement anchor, shared by locked coordinates.
    return index * 2 + offset
  }

  private addFamily(
    points: Vertex[], alternatives: { edges: LinearHalfspace[]; slack: number }[],
    ids: Map<Vertex, number>, families: Family[], parents: number[], find: (index: number) => number,
  ): void {
    const vertices = [...new Set(points.filter((point): boolean => !point.locked).map((point): number => ids.get(point)!))]
    if (vertices.length === 0) {
      this.stats.skippedLockedFamilies = Number(this.stats.skippedLockedFamilies) + 1
      return
    }
    const id = families.length
    this.stats.generatedNormalChoices = Number(this.stats.generatedNormalChoices) + alternatives.length
    const possible = alternatives.filter(({ edges }): boolean => edges.every((edge): boolean =>
      edge.terms.reduce((minimum, term): number => minimum + term.coefficient * (term.coefficient > 0 ? this.lowerBounds[term.variable]! : this.upperBounds[term.variable]!), 0) <= edge.maximum + 1e-11,
    ))
    this.stats.prunedSideChoices = Number(this.stats.prunedSideChoices) + alternatives.length - possible.length
    if (possible.length === 0) {
      // A contact outside this finite separating-normal family cannot constrain every
      // otherwise eligible contact into one infeasible component. Keep its
      // explicit unresolved status; only the unchanged physical/reference
      // publication guards can accept a partially repaired candidate.
      this.stats.emptySideDomains = Number(this.stats.emptySideDomains) + 1
      this.stats.unresolvedFamilies = Number(this.stats.unresolvedFamilies) + 1
      return
    }
    const root = find(vertices[0]!)
    for (const index of vertices) parents[find(index)] = root
    possible.sort((a, b): number => b.slack - a.slack)
    families.push({ id, vertices, alternatives: possible.map(({ edges }): LinearHalfspace[] =>
      edges.map((edge): LinearHalfspace => ({ ...edge, family: id })),
    ) })
  }

  private startComponent(): void {
    const component = this.components[this.componentIndex]!
    if (
      component.vertices.length > this.limits.vertices || this.totalChecks >= this.limits.constraintChecks ||
      component.families.some((family): boolean => family.alternatives.length === 0)
    ) {
      this.stats.unknownComponents = Number(this.stats.unknownComponents) + 1
      this.stats.retainedOriginalVertices = Number(this.stats.retainedOriginalVertices) + component.vertices.length
      this.componentIndex++
      return
    }
    const variableMap = new Map<number, number>([[0, 0]])
    for (const index of component.vertices) {
      variableMap.set(index * 2 + 1, variableMap.size)
      variableMap.set(index * 2 + 2, variableMap.size)
    }
    this.active = {
      component, variableMap, pending: [component.families.map((): number => 0)],
      seen: new Set(), branches: 0,
    }
  }

  private startBranch(active: ActiveComponent): void {
    if (active.branches >= this.limits.branches || active.pending.length === 0 || this.totalChecks >= this.limits.constraintChecks) {
      this.stats.unknownComponents = Number(this.stats.unknownComponents) + 1
      this.stats.retainedOriginalVertices = Number(this.stats.retainedOriginalVertices) + active.component.vertices.length
      this.active = undefined
      this.componentIndex++
      return
    }
    const choices = active.pending.pop()!
    const key = choices.join(",")
    if (active.seen.has(key)) return
    active.seen.add(key)
    const edges: LinearHalfspace[] = []
    for (const index of active.component.vertices) {
      const vertex = this.vertices[index]!
      for (const axis of ["x", "y"] as const) {
        const variable = active.variableMap.get(index * 2 + (axis === "x" ? 1 : 2))!
        const lower = Math.max(-0.25, vertex.bounds[axis === "x" ? "minX" : "minY"] - vertex.original[axis])
        const upper = Math.min(0.25, vertex.bounds[axis === "x" ? "maxX" : "maxY"] - vertex.original[axis])
        edges.push({ terms: [{ variable, coefficient: 1 }], maximum: upper }, { terms: [{ variable, coefficient: -1 }], maximum: -lower })
      }
    }
    for (let index = 0; index < active.component.families.length; index++) {
      const family = active.component.families[index]!
      for (const edge of family.alternatives[choices[index]!]!) {
        const terms = edge.terms.map((term): LinearHalfspace["terms"][number] => {
          const variable = active.variableMap.get(term.variable)
          if (variable === undefined) throw new Error("Convex component lost a shared endpoint variable")
          return { ...term, variable }
        })
        edges.push({ ...edge, terms })
      }
    }
    active.choices = choices
    this.stats.branchConstraintEdges = Number(this.stats.branchConstraintEdges) + edges.length
    this.stats.branchVariableInstances = Number(this.stats.branchVariableInstances) + active.variableMap.size
    this.stats.maxBranchVariables = Math.max(Number(this.stats.maxBranchVariables), active.variableMap.size)
    this.stats.maxBranchRows = Math.max(Number(this.stats.maxBranchRows), edges.length)
    this.stats.changedFamilyChoices = Number(this.stats.changedFamilyChoices) + choices.filter((choice): boolean => choice !== 0).length
    this.stats.selectedObliqueRows = Number(this.stats.selectedObliqueRows) + edges.filter((row): boolean =>
      row.terms.some((term): boolean => term.variable % 2 === 1) && row.terms.some((term): boolean => term.variable % 2 === 0),
    ).length
    active.branches++
    this.stats.branches = Number(this.stats.branches) + 1
    active.solver = new HalfspaceProjectionSolver(active.variableMap.size, edges, this.limits.constraintChecks - this.totalChecks)
  }

  private finishBranch(active: ActiveComponent): void {
    const solver = active.solver!
    const result = solver.getOutput()
    active.solver = undefined
    for (const key of ["preprocessingRows", "canonicalizedTerms", "hashProbes", "hashKeyCharacters", "canonicalSortComparisons", "exactRowChecks", "proofTermReads", "exactTermComparisons", "proofSortComparisons"]) {
      this.stats[key] = Number(this.stats[key]) + Number(solver.stats[key])
    }
    this.stats.projectionSweeps = Number(this.stats.projectionSweeps) + Number(solver.stats.sweeps)
    this.stats.rowUpdates = Number(this.stats.rowUpdates) + Number(solver.stats.rowUpdates)
    this.stats.residualChecks = Number(this.stats.residualChecks) + Number(solver.stats.residualChecks)
    if (result.status === "feasible") {
      let valid = true
      for (const index of active.component.vertices) {
        const vertex = this.vertices[index]!
        for (const axis of ["x", "y"] as const) {
          const variable = active.variableMap.get(index * 2 + (axis === "x" ? 1 : 2))!
          const lower = Math.max(vertex.bounds[axis === "x" ? "minX" : "minY"], vertex.original[axis] - 0.25)
          const upper = Math.min(vertex.bounds[axis === "x" ? "maxX" : "maxY"], vertex.original[axis] + 0.25)
          const coordinate = Math.max(lower, Math.min(upper, vertex.original[axis] + result.values[variable]!))
          result.values[variable] = coordinate - vertex.original[axis]
          valid &&= Number.isFinite(coordinate) && Math.abs(coordinate - vertex.original[axis]) <= 0.25
        }
      }
      if (solver.constraints.length > this.limits.constraintChecks - this.totalChecks) valid = false
      if (valid) for (const row of solver.constraints) {
        let residual = -row.maximum
        for (const term of row.terms) residual += term.coefficient * result.values[term.variable]!
        this.totalChecks++
        this.stats.witnessChecks = Number(this.stats.witnessChecks) + 1
        valid &&= Number.isFinite(residual) && residual <= 1e-9
      }
      this.stats.constraintChecks = this.totalChecks
      if (valid) {
        for (const index of active.component.vertices) {
          const vertex = this.vertices[index]!
          vertex.x = vertex.original.x + result.values[active.variableMap.get(index * 2 + 1)!]!
          vertex.y = vertex.original.y + result.values[active.variableMap.get(index * 2 + 2)!]!
          if (vertex.x !== vertex.original.x || vertex.y !== vertex.original.y) {
            this.stats.movedVertices = Number(this.stats.movedVertices) + 1
          }
        }
        this.stats.solvedComponents = Number(this.stats.solvedComponents) + 1
        this.active = undefined
        this.componentIndex++
        return
      }
    } else {
      let branchFamilies: number[]
      if (result.status === "contradictory-choice") {
        const proofStats: OppositeRowCheckStats = { rowChecks: 0, termReads: 0, termComparisons: 0, sortComparisons: 0 }
        const certificate = getOppositeRowCertificate(solver.constraints, result.certificate.rows[0], result.certificate.rows[1], 1e-10, proofStats)
        this.stats.certificateRechecks = Number(this.stats.certificateRechecks) + 1
        this.stats.exactRowChecks = Number(this.stats.exactRowChecks) + proofStats.rowChecks
        this.stats.proofTermReads = Number(this.stats.proofTermReads) + proofStats.termReads
        this.stats.exactTermComparisons = Number(this.stats.exactTermComparisons) + proofStats.termComparisons
        this.stats.proofSortComparisons = Number(this.stats.proofSortComparisons) + proofStats.sortComparisons
        if (!certificate || JSON.stringify(certificate) !== JSON.stringify(result.certificate)) throw new Error("Selected-scope opposite-row certificate failed independent recheck")
        this.stats.certifiedChoiceContradictions = Number(this.stats.certifiedChoiceContradictions) + 1
        this.stats.certifiedFamilyReferences = Number(this.stats.certifiedFamilyReferences) + certificate.families.length
        if (certificate.families.length === 0) this.stats.boundedHardContradictions = Number(this.stats.boundedHardContradictions) + 1
        branchFamilies = certificate.families
      } else {
        this.stats.unknownChoiceAssignments = Number(this.stats.unknownChoiceAssignments) + 1
        const reasonKey = {
          "work-cap": "workLimitedAssignments", "sweep-cap": "sweepLimitedAssignments",
          numerical: "numericalAssignments", "constant-constraint": "constantConstraintAssignments",
        }[result.reason]
        this.stats[reasonKey] = Number(this.stats[reasonKey]) + 1
        branchFamilies = result.residualFamilies.slice(0, 4)
      }
      // Certified pairs exclude only this exact selected side assignment.
      // Uncertified residuals remain heuristic suggestions, never hard cores.
      for (const familyId of branchFamilies) {
        const index = active.component.families.findIndex((family): boolean => family.id === familyId)
        if (index < 0) throw new Error("Projection residual refers to another convex component")
        for (let choice = active.component.families[index]!.alternatives.length - 1; choice >= 0; choice--) {
          if (choice === active.choices![index]) continue
          const next = [...active.choices!]
          next[index] = choice
          if (!active.seen.has(next.join(","))) {
            if (active.pending.length < 128) {
              active.pending.push(next)
              if (result.status === "contradictory-choice") this.stats.certifiedBranchesGenerated = Number(this.stats.certifiedBranchesGenerated) + 1
              else this.stats.residualBranches = Number(this.stats.residualBranches) + 1
            } else this.stats.discardedBranchChoices = Number(this.stats.discardedBranchChoices) + 1
          }
        }
      }
      return
    }
    // Numerical uncertainty or a consumed work budget cannot produce a clause.
    this.stats.unknownComponents = Number(this.stats.unknownComponents) + 1
    this.stats.retainedOriginalVertices = Number(this.stats.retainedOriginalVertices) + active.component.vertices.length
    this.active = undefined
    this.componentIndex++
  }

  private requiredForPair(pair: PreparedState["pairs"][number]): number {
    const input = this.preparation.input
    const radius = pair.a.radius + pair.b.radius
    if (!pair.a.via || !pair.b.via) return radius + (input.traceClearance ?? 0.1)
    // Drill separation is independent of electrical ownership. Preserve a
    // conservative annulus gap as well, even for distinct same-net sites.
    return Math.max(
      radius + (input.viaClearance ?? 0.1),
      this.drillSeparation,
    )
  }

  private pairViolated(pair: PreparedState["pairs"][number]): boolean {
    this.stats.verificationPairChecks = Number(this.stats.verificationPairChecks) + 1
    const required = this.requiredForPair(pair)
    return segmentToSegmentMinDistance(pair.a.a, pair.a.b, pair.b.a, pair.b.b) < required
  }

  private padViolated(pad: PreparedState["padContacts"][number]): boolean {
    this.stats.verificationPadChecks = Number(this.stats.verificationPadChecks) + 1
    for (const point of [pad.segment.a, pad.segment.b]) {
      if (pad.corners.every((a, index): boolean => {
        const b = pad.corners[(index + 1) % pad.corners.length]!
        return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= 0
      })) return true
    }
    for (let index = 0; index < pad.corners.length; index++) {
      if (segmentToSegmentMinDistance(
        pad.segment.a, pad.segment.b, pad.corners[index]!,
        pad.corners[(index + 1) % pad.corners.length]!,
      ) < pad.required) return true
    }
    return false
  }

  private verifyGeometry(): void {
    const state = this.prepared!
    let batch = 0
    while (batch < 4096 && this.verificationIndex < state.pairs.length + state.padContacts.length) {
      const index = this.verificationIndex++
      const isPair = index < state.pairs.length
      const localIndex = isPair ? index : index - state.pairs.length
      const key = `${isPair ? "pair" : "pad"}:${localIndex}`
      batch++
      if (this.activeFamilyKeys.has(key)) continue
      const violated = isPair
        ? this.pairViolated(state.pairs[localIndex]!)
        : this.padViolated(state.padContacts[localIndex]!)
      if (violated) {
        this.activeFamilyKeys.add(key)
        this.verificationAdded++
      }
    }
    if (this.verificationIndex < state.pairs.length + state.padContacts.length) return
    this.separationRound++
    this.stats.separationRounds = this.separationRound
    if (this.verificationAdded > 0) {
      // New violations cannot be published merely because a restricted model
      // was feasible. Restore the transaction and strengthen the next model.
      for (const vertex of this.vertices) {
        vertex.x = vertex.original.x
        vertex.y = vertex.original.y
      }
      if (this.separationRound < 4 && this.totalChecks < this.limits.constraintChecks) {
        this.phase = "components"
        return
      }
      this.stats.rolledBackUncertainCandidate = 1
    }
    this.phase = "finalize"
  }

  override _step(): void {
    if (this.phase === "prepare") {
      const state = this.getPreparedState()
      if (state.phase === "sweeps") {
        this.prepared = state
        this.reserveCollectiveIterations(state)
        this.phase = "components"
      } else {
        this.preparation.step()
        if (this.preparation.failed) throw new Error(`Native convex preparation failed: ${this.preparation.error}`)
        this.stats.preparedSteps = Number(this.stats.preparedSteps) + 1
        const remaining = Math.max(0, this.preparation.MAX_ITERATIONS - this.preparation.iterations)
        const maximum = this.iterations + remaining + 4
        if (!Number.isSafeInteger(maximum)) {
          throw new Error("Native preparation scheduler allowance is invalid")
        }
        this.MAX_ITERATIONS = Math.max(this.MAX_ITERATIONS, maximum)
      }
    } else if (this.phase === "components") {
      this.prepareComponents()
    } else if (this.phase === "solve") {
      if (this.componentIndex === this.components.length) {
        this.phase = "verify"
        this.verificationIndex = 0
        this.verificationAdded = 0
      } else if (!this.active) {
        this.startComponent()
      } else if (!this.active.solver) {
        this.startBranch(this.active)
      } else {
        const solver = this.active.solver
        const previous = solver.constraintChecks
        solver.step()
        this.totalChecks += solver.constraintChecks - previous
        this.stats.constraintChecks = this.totalChecks
        if (solver.solved) this.finishBranch(this.active)
      }
    } else if (this.phase === "verify") {
      this.verifyGeometry()
    } else {
      this.prepared!.phase = "finalize"
      this.preparation.step()
      if (!this.preparation.solved) throw new Error("Native convex finalization did not complete")
      this.output = this.preparation.getOutput()
      this.solved = true
      this.progress = 1
    }
  }

  getOutput(): Routes {
    if (!this.solved || !this.output) {
      throw new Error("Collective fixed-topology candidate is incomplete")
    }
    return this.output
  }
}
