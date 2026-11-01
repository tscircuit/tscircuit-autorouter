import { InteractiveGraphics } from "graphics-debug/react"
import { useEffect, useState } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import inputUrl from "./input.srj.json.gz?url"
import outputUrl from "./captured-output.srj.json.gz?url"

type View = "Input" | "Captured output" | "Route input"

function PowerPhaseFixture({ view }: { view: View }): React.JSX.Element {
  const [srj, setSrj] = useState<SimpleRouteJson | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    async function load(): Promise<void> {
      try {
        const response = await fetch(
          view === "Captured output" ? outputUrl : inputUrl,
        )
        if (!response.ok || !response.body) {
          throw new Error(
            `Unable to load power-phase fixture: ${response.status}`,
          )
        }
        const stream = response.body.pipeThrough(
          new DecompressionStream("gzip"),
        )
        const data: SimpleRouteJson = await new Response(stream).json()
        if (!disposed) setSrj(data)
      } catch (cause) {
        if (!disposed) setError(String(cause))
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [view])
  if (error) return <p role="alert">{error}</p>
  if (!srj) return <p>Loading power-phase fixture…</p>
  return (
    <div>
      <h2>Bug report 110: motherboard power phase — {view}</h2>
      <p>
        <a href="https://github.com/tscircuit/tscircuit-autorouter/issues/3342">
          GitHub issue #3342
        </a>
        {" · "}
        {srj.connections.length} connections · {srj.traces?.length} traces · 4
        layers
      </p>
      {view === "Captured output" && (
        <p>Historical captured output; not a DRC-clean reference.</p>
      )}
      {view === "Route input" ? (
        <AutoroutingPipelineDebugger
          srj={srj}
          createSolver={(input, opts) =>
            new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
              ...opts,
              cacheProvider: null,
            })
          }
        />
      ) : (
        <InteractiveGraphics graphics={convertSrjToGraphicsObject(srj)} />
      )}
    </div>
  )
}

export default {
  Input: <PowerPhaseFixture view="Input" />,
  "Captured output": <PowerPhaseFixture view="Captured output" />,
  "Route input": <PowerPhaseFixture view="Route input" />,
}
