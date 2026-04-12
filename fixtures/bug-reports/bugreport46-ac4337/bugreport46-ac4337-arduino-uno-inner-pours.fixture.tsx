import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import {
  ARDUINO_UNO_GROUND_NET,
  ARDUINO_UNO_POWER_NET,
  arduinoUnoWithPowerGroundInnerPours,
} from "./bugreport46-ac4337-arduino-uno-inner-pours"

export default () => {
  return (
    <div className="p-2">
      <div className="mb-2 text-sm">
        Arduino Uno with inner power/ground pours
      </div>
      <div className="mb-3 text-xs text-gray-700">
        Assumed Uno mapping: `inner1` =&gt; {ARDUINO_UNO_POWER_NET} (5V/IOREF),
        `inner2` =&gt; {ARDUINO_UNO_GROUND_NET} (GND).
      </div>
      <AutoroutingPipelineDebugger srj={arduinoUnoWithPowerGroundInnerPours} />
    </div>
  )
}
