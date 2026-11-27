import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

type JointRepairParams = ConstructorParameters<
  typeof Pipeline9JointDrcRepairSolver
>[0]

export type Srj23Sample57JointDrcRepairFixture = Omit<
  JointRepairParams,
  "connMap" | "mutatedPreloadedTraceIds"
> & {
  netMap: Record<string, string[]>
  mutatedPreloadedTraceIds: string[]
}

export type Srj23Sample57JointDrcRepairHarness = {
  jointRepairParams: Omit<
    Srj23Sample57JointDrcRepairFixture,
    "netMap" | "mutatedPreloadedTraceIds"
  >
  connMap: ConnectivityMap
  convertNewRoutes: ReturnType<
    typeof createPipeline7HdRoutesToSimplifiedPcbTracesConverter
  >
  createSolver: () => Pipeline9JointDrcRepairSolver
}

export function loadSrj23Sample57JointDrcRepairFixture(): Srj23Sample57JointDrcRepairFixture {
  return JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/srj23-sample57-joint-drc-repair.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as Srj23Sample57JointDrcRepairFixture
}

export function createSrj23Sample57JointDrcRepairHarness(): Srj23Sample57JointDrcRepairHarness {
  const fixture = loadSrj23Sample57JointDrcRepairFixture()
  const { netMap, mutatedPreloadedTraceIds, ...jointRepairParams } = fixture
  const connMap = new ConnectivityMap(structuredClone(netMap))
  const convertNewRoutes =
    createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
      connections: jointRepairParams.newConnections,
      originalConnections: jointRepairParams.originalSrj.connections,
      layerCount: jointRepairParams.layerCount,
      obstacles: jointRepairParams.obstacles,
      defaultViaHoleDiameter: jointRepairParams.defaultViaHoleDiameter,
      connMap,
    })
  const createSolver = (): Pipeline9JointDrcRepairSolver =>
    new Pipeline9JointDrcRepairSolver({
      ...jointRepairParams,
      connMap,
      mutatedPreloadedTraceIds: new Set(mutatedPreloadedTraceIds),
    })
  return { jointRepairParams, connMap, convertNewRoutes, createSolver }
}
