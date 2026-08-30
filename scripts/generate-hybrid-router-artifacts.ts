import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
} from "graphics-debug"
import { AutoroutingPipelineSolver12_HybridTransactionalRouter } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/AutoroutingPipelineSolver12_HybridTransactionalRouter"
import { createHybridRoutingTestFixture } from "tests/hybrid-transactional-router/fixtures"

const runtimeModulePath = process.argv[2]
const requestedOutputDirectory = process.argv[3]
if (!runtimeModulePath || !requestedOutputDirectory) {
  throw new Error(
    "usage: bun scripts/generate-hybrid-router-artifacts.ts <native-module-path> <output-directory>",
  )
}
const outputDirectory = resolve(requestedOutputDirectory)
await mkdir(outputDirectory, { recursive: true })
const fixture = createHybridRoutingTestFixture()
const workerEntryPath = resolve(
  "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/hybrid-routing-worker.ts",
)
const solver = new AutoroutingPipelineSolver12_HybridTransactionalRouter(
  fixture.simpleRouteJson,
  {
    routingRules: fixture.routingRules,
    execution: {
      kind: "parallel",
      workerEntryPath,
      runtimeTarget: "native",
      runtimeModulePath,
      maximumConcurrency: 4,
      maximumWorkerQueueLength: 32,
    },
    deterministicSeed: 17,
    maximumSearchExpansions: 250_000,
    maximumActivationRings: 4,
    maximumTransactionHistory: 64,
    maximumDemandCellCount: 100_000,
    maximumRegionCount: 128,
    maximumRegionMutationCount: 128,
    maximumMergeRegionCount: 8,
    maximumEstimatedMemoryBytesPerObject: 32 * 1024 * 1024,
    maximumWaveMemoryBytes: 128 * 1024 * 1024,
    maximumFinalViolationCount: 64,
  },
)
await solver.solveAsync()
const result = solver.getResult()
if (result?.status !== "solved") {
  throw new Error(
    `artifact fixture did not solve: ${result?.status === "failed" || result?.status === "partial" ? result.diagnostic.message : "missing result"}`,
  )
}
const artifacts: string[] = []
for (const visualization of solver.getVisualizations()) {
  const basePath = resolve(outputDirectory, visualization.name)
  const pngPath = `${basePath}.png`
  const svgPath = `${basePath}.svg`
  const graphicsPath = `${basePath}.graphics.json`
  await writeFile(
    pngPath,
    await getPngBufferFromGraphicsObject(visualization.graphics, {
      backgroundColor: "white",
      pngWidth: 1536,
      pngHeight: 1536,
    }),
  )
  await writeFile(
    svgPath,
    getSvgFromGraphicsObject(visualization.graphics, {
      backgroundColor: "white",
    }),
  )
  await writeFile(
    graphicsPath,
    JSON.stringify(visualization.graphics, null, 2),
  )
  artifacts.push(pngPath, svgPath, graphicsPath)
}
const metricsPath = resolve(outputDirectory, "metrics.json")
const routePath = resolve(outputDirectory, "routed-simple-route.json")
await writeFile(metricsPath, JSON.stringify(result.metrics, null, 2))
await writeFile(
  routePath,
  JSON.stringify(result.routedSimpleRouteJson, null, 2),
)
artifacts.push(metricsPath, routePath)
const engineResult = solver.getLastEngineResult()
console.log(
  JSON.stringify({
    status: result.status,
    artifactCount: artifacts.length,
    outputDirectory,
    routeHash:
      engineResult?.status === "routed"
        ? engineResult.verification.routeHash
        : "unavailable",
  }),
)
