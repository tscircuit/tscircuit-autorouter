import {
  TinyHyperGraphSolver,
  initTinyHypergraphWasm,
  loadSerializedHyperGraph,
  type LoadedHyperGraph,
  type GraphicsObject,
  type SerializedHyperGraph,
  type TinyHyperGraphProblem,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphSolverConfiguration,
  type TinyHyperGraphTopology,
} from "@tscircuit/tiny-hypergraph-wasm"

declare const topology: TinyHyperGraphTopology
declare const problem: TinyHyperGraphProblem

const options: TinyHyperGraphSolverOptions = { MAX_ITERATIONS: 100, VERBOSE: false }
const solver = new TinyHyperGraphSolver(topology, problem, options)
const configuration: TinyHyperGraphSolverConfiguration = {
  variant: "selective-rerip",
  preserveInitialAssignments: true,
}
new TinyHyperGraphSolver(topology, problem, options, configuration)
// @ts-expect-error Solver variants are an explicit union.
new TinyHyperGraphSolver(topology, problem, options, { variant: "unknown" })
const output: SerializedHyperGraph = solver.getOutput()
const loaded: LoadedHyperGraph = loadSerializedHyperGraph(output)
new TinyHyperGraphSolver(loaded.topology, loaded.problem)
const segment: [number, number] | undefined = loaded.solution.solvedRoutePathSegments[0]?.[0]
// @ts-expect-error Serialized graph geometry is required.
loadSerializedHyperGraph({ connections: [] })
// @ts-expect-error Loaded graphs have a typed numeric topology.
const invalidLoaded: string = loaded.topology
const graphics: GraphicsObject = solver.visualize()
const error: string | null = solver.getStatus().error
const route: number | undefined = solver.getRoutingSnapshot().currentRouteId
const net: number | undefined = solver.getRoutingSnapshot().portAssignment[0]
const unknownStat: unknown = solver.getStats().customStat
const initialized: Promise<void> = initTinyHypergraphWasm(new Uint8Array())

// @ts-expect-error Options retain their Rust/TS solver value types.
new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: "100" })
// @ts-expect-error Required graph structure cannot be omitted.
new TinyHyperGraphSolver({}, problem)
// @ts-expect-error Only numeric batch counts are accepted.
solver.stepMany("100")
// @ts-expect-error Routing snapshots contain numeric IDs.
solver.getRoutingSnapshot().portAssignment.push("net-0")
// @ts-expect-error Stats remain unknown until callers narrow the value.
const numericStat: number = solver.getStats().customStat
// @ts-expect-error Output is a serialized graph, not an untyped value.
const invalidOutput: string = solver.getOutput()
// @ts-expect-error Graphics output is typed as GraphicsObject.
const invalidGraphics: string = solver.preview()
// @ts-expect-error Initialization takes a WASM source, not a numeric ID.
initTinyHypergraphWasm(42)

void [output, graphics, error, route, net, unknownStat, initialized, numericStat, invalidOutput, invalidGraphics]
