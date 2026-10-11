import { AUTOROUTER_VERSION } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { solvePipeline9NetworkedHighDensityNode } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode"
import { getGlobalInMemoryCache } from "../../lib/cache/setupGlobalCaches"
import { createLocalHighDensityServer } from "./createLocalHighDensityServer"
import {
  normalizeLocalHighDensityJson,
  type LocalHighDensityObject,
} from "./localHighDensityProtocol"
import { normalizeLocalHighDensityNodeResult } from "./normalizeLocalHighDensityNodeResult"

export function startLocalHighDensityServerProcess(): void {
  const expectedVersion = process.argv[2]
  if (expectedVersion !== AUTOROUTER_VERSION) {
    throw new Error(
      `Local high-density checkout version ${AUTOROUTER_VERSION} does not equal requested version ${expectedVersion}`,
    )
  }
  const handler = createLocalHighDensityServer({
    autorouterVersion: AUTOROUTER_VERSION,
    solve: (input: LocalHighDensityObject): LocalHighDensityObject => {
      getGlobalInMemoryCache().clearCache()
      const nodeInput = input as unknown as Parameters<
        typeof solvePipeline9NetworkedHighDensityNode
      >[0]
      return normalizeLocalHighDensityJson(
        normalizeLocalHighDensityNodeResult(
          nodeInput,
          solvePipeline9NetworkedHighDensityNode(nodeInput),
        ),
      ) as LocalHighDensityObject
    },
    onFault: (error: Error): void => {
      console.error(
        `Local high-density helper failed: ${error.stack ?? error.message}`,
      )
      process.exitCode = 1
      setTimeout(() => process.exit(1), 0)
    },
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler.fetch,
  })
  const stop = (): void => {
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
    server.stop(true)
    process.exit(0)
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  console.log(
    `LOCAL_HD_READY ${JSON.stringify({
      autorouterVersion: AUTOROUTER_VERSION,
      pid: process.pid,
      url: `http://127.0.0.1:${server.port}`,
    })}`,
  )
}

if (import.meta.main) startLocalHighDensityServerProcess()
