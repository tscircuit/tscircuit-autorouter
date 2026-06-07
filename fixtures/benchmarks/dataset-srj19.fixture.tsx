import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const isSimpleRouteJson = (value: unknown): value is DatasetCircuit["srj"] => {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<DatasetCircuit["srj"]>
  return (
    typeof candidate.layerCount === "number" &&
    typeof candidate.minTraceWidth === "number" &&
    Array.isArray(candidate.obstacles) &&
    Array.isArray(candidate.connections) &&
    Boolean(candidate.bounds)
  )
}

const samplePathPattern = /\/sample(\d{3})\.circuit\.simple-route\.json$/

// @ts-ignore
const srjModules = import.meta.glob(
  "../../node_modules/@tsci/tscircuit.dataset-srj19-bga-passive-overlays/circuits/sample*/sample*.circuit.simple-route.json",
  {
    eager: true,
    import: "default",
  },
) as Record<string, DatasetCircuit["srj"]>

const circuits = Object.entries(srjModules)
  .map(([path, srj]): DatasetCircuit | null => {
    const sampleMatch = path.match(samplePathPattern)
    if (!sampleMatch || !isSimpleRouteJson(srj)) return null

    return {
      id: sampleMatch[1],
      srj,
    }
  })
  .filter((circuit): circuit is DatasetCircuit => circuit !== null)
  .sort((a, b) => Number(a.id) - Number(b.id))

export default () => (
  <DatasetBenchmarkFixture datasetLabel="dataset-srj19" circuits={circuits} />
)
