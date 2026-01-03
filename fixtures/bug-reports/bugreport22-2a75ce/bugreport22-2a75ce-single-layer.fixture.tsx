// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport22-2a75ce.json"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={{
        ...bugReportJson,
        obstacles: bugReportJson.obstacles.map((o) => ({
          ...o,
          zLayers: [0],
          layers: ["top"],
        })),
        layerCount: 1,
      }}
    />
  )
}
