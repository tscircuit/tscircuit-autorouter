// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import srj from "./bugreport79-rk3326-usb.srj.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={srj} />
}
