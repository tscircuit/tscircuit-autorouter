import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import { useEffect, useState } from "react"
import { renderSepicRepro } from "./render"

export default (): ReactElement => {
  const [input, setInput] = useState<SimpleRouteJson>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    renderSepicRepro()
      .then(({ input }) => setInput(input))
      .catch((error) => setError(String(error)))
  }, [])
  if (error) return <pre>{error}</pre>
  if (!input) return <div>Rendering circuit TSX…</div>
  return (
    <AutoroutingPipelineDebugger
      srj={input}
      createSolver={(srj, opts) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
          ...opts,
          cacheProvider: null,
          effort: 1,
        })
      }
    />
  )
}
