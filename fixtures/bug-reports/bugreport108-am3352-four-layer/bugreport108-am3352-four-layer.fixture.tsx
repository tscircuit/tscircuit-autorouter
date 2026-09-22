import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./am3352-four-layer.srj.json"

export default function Am3352FourLayerBugReport(): React.JSX.Element {
  return (
    <div>
      <div style={{ padding: 16 }}>
        <h2>AM3352 four-layer board — route from scratch</h2>
        <p style={{ color: "#b91c1c" }}>
          Known Pipeline 9 failure: high-density routing cannot solve
          {" "}topology_merge_3012 after expanding the region to 8x.
          A fresh solve took about 187 seconds; it did not hit the test timeout.
        </p>
        <p>
          70 × 60 mm · 138 connections · 774 terminals · 907 obstacles.
          All nets are submitted together, without routing phases, saved routes,
          fanout escapes, or preconnected copper pours. Via-in-pad is disabled.
        </p>
        <p>
          Source: <a href="https://github.com/tscircuit/am3352-dev-board/tree/e3d915e3df52023763f1ea85ebe4c20401b52790">AM3352 board v0.1.5</a>.
          Six bus skew constraints are retained. All four layers are available;
          this is an autorouter reproduction, not an electrically qualified DDR layout.
        </p>
      </div>
      <AutoroutingPipelineDebugger srj={srj as SimpleRouteJson} />
    </div>
  )
}
