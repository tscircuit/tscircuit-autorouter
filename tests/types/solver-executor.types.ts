import type {
  AutorouterExecutor,
  SolverExecutor,
  SolverTaskDefinition,
} from "../../lib/execution/SolverExecutor"

type RepairTasks = {
  "repair/node": SolverTaskDefinition<{ nodeId: string }, { routes: number[] }>
}

type HypergraphTasks = {
  "hypergraph/route": SolverTaskDefinition<
    { routeId: number },
    { ports: number[] },
    { topology: SharedArrayBuffer }
  >
}

declare const executor: SolverExecutor<RepairTasks & HypergraphTasks>
declare const topology: SharedArrayBuffer

const repairResult: Promise<{ routes: number[] }> = executor.execute(
  "repair/node",
  { nodeId: "node-1" },
  { shared: undefined },
)
const hypergraphResult: Promise<{ ports: number[] }> = executor.execute(
  "hypergraph/route",
  { routeId: 1 },
  { shared: { topology } },
)

// One host executor can be supplied to solvers with smaller catalogs.
const repairExecutor: SolverExecutor<RepairTasks> = executor
const autorouterExecutor: AutorouterExecutor = executor

const noSharedData = { shared: undefined }
const ordinaryTopology = { shared: { topology: new ArrayBuffer(8) } }
// @ts-expect-error Unknown task kind.
executor.execute("repair/unknown", { nodeId: "node-1" }, noSharedData)
// @ts-expect-error Input must match the selected task kind.
executor.execute("repair/node", { routeId: 1 }, noSharedData)
// @ts-expect-error Required shared topology cannot be omitted.
executor.execute("hypergraph/route", { routeId: 1 }, noSharedData)
// @ts-expect-error An ordinary buffer is not shared storage.
executor.execute("hypergraph/route", { routeId: 1 }, ordinaryTopology)
// @ts-expect-error The task result is inferred from its kind.
const wrongResult: Promise<string> = repairResult

void [
  repairResult,
  hypergraphResult,
  repairExecutor,
  autorouterExecutor,
  wrongResult,
]
