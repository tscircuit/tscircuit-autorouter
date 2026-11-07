import { useMemo, type JSX } from "react"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import { getRvboyLcdPortPointRepro } from "./getRvboyLcdPortPointRepro"
import input from "./rvboy-phase1.srj.json"

export default function RvboyLcdPortPointsRepro(): JSX.Element {
  const { views } = useMemo(getRvboyLcdPortPointRepro, [])
  return (
    <div>
      {views.map((view) => (
        <div key={view.name} dangerouslySetInnerHTML={{ __html: view.svg }} />
      ))}
      <AutoroutingPipelineDebugger srj={input as SimpleRouteJson} />
    </div>
  )
}
