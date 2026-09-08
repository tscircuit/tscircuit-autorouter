import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { RootCircuit } from "@tscircuit/core"
import { Fragment } from "react"
import type { AutorouterConfig } from "@tscircuit/props"
import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import {
  CommonMcu,
  LogButton,
  automaticSchematic,
} from "./fixtures/gps-logger-CommonMcu"
import { ATGM336H_5N31 } from "./fixtures/gps-logger-imports/ATGM336H_5N31"
import { MCP73831T_2ACI_OT } from "./fixtures/gps-logger-imports/MCP73831T_2ACI_OT"
import { PCF85063ATL_1_118 } from "./fixtures/gps-logger-imports/PCF85063ATL_1_118"
import { TF_01A } from "./fixtures/gps-logger-imports/TF_01A"
import { U_FL_R_SMT_1_80_ } from "./fixtures/gps-logger-imports/U_FL_R_SMT_1_80_"
import { S2B_PH_SM4_TB_LF__SN_ } from "./fixtures/gps-logger-imports/S2B_PH_SM4_TB_LF__SN_"

const nets: Record<string, string[]> = {
  GND: [
    "J_BAT.pin2",
    "U_CHG.VSS",
    "R_PROG.pin2",
    "R_GATE.pin2",
    "C_CHG_IN.pin2",
    "C_BAT.pin2",
    "C_SYS.pin2",
    "U_GNSS.GND1",
    "U_GNSS.GND2",
    "U_GNSS.GND3",
    "J_ANT.GND1",
    "J_ANT.GND2",
    "C_GPS.pin2",
    "C_GPS_BULK.pin2",
    "C_BACKUP.pin2",
    "U_RTC.VSS",
    "U_RTC.CLKOE",
    "C_RTC.pin2",
    "J_SD.VSS",
    "J_SD.GND1",
    "J_SD.GND2",
    "J_SD.GND3",
    "J_SD.GND4",
    "C_SD.pin2",
    "C_SD_BULK.pin2",
    "SW_LOG.pin4",
    "D_FIX.cathode",
    "R_BAT_LO.pin2",
    "C_BAT_ADC.pin2",
  ],
  VBUS: [
    "U_CHG.VDD",
    "C_CHG_IN.pin1",
    "Q_LOAD.G",
    "R_GATE.pin1",
    "R_CHARGE.pin1",
  ],
  BAT: ["J_BAT.pin1", "U_CHG.VBAT", "Q_LOAD.D", "C_BAT.pin1", "R_BAT_HI.pin1"],
  VSYS: ["Q_LOAD.S", "C_SYS.pin1"],
  V3V3: [
    "R_GPS_FILTER.pin1",
    "U_RTC.VDD",
    "C_RTC.pin1",
    "R_SDA.pin1",
    "R_SCL.pin1",
    "R_RTC_INT.pin1",
    "J_SD.VDD",
    "C_SD.pin1",
    "C_SD_BULK.pin1",
    "R_SD_CS.pin1",
    "R_SD_MISO.pin1",
    "R_SD_D1.pin1",
    "R_SD_D2.pin1",
    "R_SD_CD.pin1",
    "R_LOG.pin1",
  ],
  GPS_VCC: [
    "R_GPS_FILTER.pin2",
    "U_GNSS.VCC",
    "U_GNSS.VBAT",
    "C_GPS.pin1",
    "C_GPS_BULK.pin1",
    "C_BACKUP.pin1",
    "R_GPS_RESET.pin1",
  ],
  GPS_RESET: ["R_GPS_RESET.pin2", "U_GNSS.NRESET"],
  GPS_RX: ["U1.GPIO0", "U_GNSS.RXD"],
  GPS_TX: ["U1.GPIO1", "U_GNSS.TXD"],
  GPS_PPS: ["U1.GPIO2", "U_GNSS.1PPS"],
  GPS_RF: ["U_GNSS.RF_IN", "J_ANT.SIG"],
  I2C_SDA: ["U1.GPIO4", "U_RTC.SDA", "R_SDA.pin2"],
  I2C_SCL: ["U1.GPIO5", "U_RTC.SCL", "R_SCL.pin2"],
  RTC_INT: ["U1.GPIO6", "U_RTC.N_INT", "R_RTC_INT.pin2"],
  RTC_X1: ["U_RTC.OSCI", "Y_RTC.pin1"],
  RTC_X2: ["U_RTC.OSCO", "Y_RTC.pin2"],
  SD_MISO: ["U1.GPIO16", "J_SD.pin7", "R_SD_MISO.pin2"],
  SD_CS: ["U1.GPIO17", "J_SD.pin2", "R_SD_CS.pin2"],
  SD_CLK_MCU: ["U1.GPIO18", "R_SD_CLK.pin1"],
  SD_CLK: ["R_SD_CLK.pin2", "J_SD.pin5"],
  SD_MOSI: ["U1.GPIO19", "J_SD.pin3"],
  SD_D1: ["J_SD.pin8", "R_SD_D1.pin2"],
  SD_D2: ["J_SD.pin1", "R_SD_D2.pin2"],
  SD_CD: ["U1.GPIO20", "J_SD.CD", "R_SD_CD.pin2"],
  LOG_BUTTON: ["U1.GPIO7", "SW_LOG.pin1", "R_LOG.pin2"],
  FIX_LED: ["U1.GPIO8", "R_FIX.pin1"],
  FIX_LED_A: ["R_FIX.pin2", "D_FIX.anode"],
  CHARGE_LED_A: ["R_CHARGE.pin2", "D_CHARGE.anode"],
  CHARGE_STAT: ["D_CHARGE.cathode", "U_CHG.STAT"],
  CHARGE_PROG: ["U_CHG.PROG", "R_PROG.pin1"],
  BAT_ADC: [
    "R_BAT_HI.pin2",
    "R_BAT_LO.pin1",
    "C_BAT_ADC.pin1",
    "U1.GPIO26_ADC0",
  ],
}

function GpsLogger({
  algorithmFn,
}: { algorithmFn: NonNullable<AutorouterConfig["algorithmFn"]> }) {
  return automaticSchematic(
    <board
      width={68}
      height={54}
      layers={2}
      thickness={1.6}
      title="GPS Logger / RP2040"
      solderMaskColor="green"
      schAutoLayoutEnabled
      schTraceAutoLabelEnabled
      schMaxTraceDistance={0.01}
      autorouter={{ local: true, algorithmFn }}
      minTraceWidth={0.1}
      defaultTraceWidth={0.15}
      minViaHoleDiameter={0.3}
      minViaPadDiameter={0.6}
    >
      <CommonMcu />
      <schematicsection
        name="gnss"
        displayName="GNSS / passive external antenna"
      />
      <schematicsection name="storage" displayName="microSD / SPI0" />
      <schematicsection name="rtc" displayName="RTC / I2C0" />
      <schematicsection
        name="charge"
        displayName="LiPo charge / load sharing"
      />
      <schematicsection
        name="controls"
        displayName="Logging controls / battery monitor"
      />
      <ATGM336H_5N31
        name="U_GNSS"
        pcbX={22}
        pcbY={-15}
        pcbRotation={180}
        schSectionName="gnss"
      />
      <U_FL_R_SMT_1_80_
        name="J_ANT"
        schHeight={0.4}
        pcbX={31}
        pcbY={-15}
        schSectionName="gnss"
      />
      <resistor
        name="R_GPS_FILTER"
        resistance="2.2"
        footprint="0603"
        pcbX={18}
        pcbY={-7}
        schSectionName="gnss"
      />
      <capacitor
        name="C_GPS"
        capacitance="100nF"
        footprint="0402"
        pcbX={14}
        pcbY={-12}
        schSectionName="gnss"
      />
      <capacitor
        name="C_GPS_BULK"
        capacitance="10uF"
        footprint="0805"
        pcbX={23}
        pcbY={-7}
        schSectionName="gnss"
      />
      <capacitor
        name="C_BACKUP"
        capacitance="100nF"
        footprint="0402"
        pcbX={14}
        pcbY={-15}
        schSectionName="gnss"
      />
      <resistor
        name="R_GPS_RESET"
        resistance="10k"
        footprint="0402"
        pcbX={29}
        pcbY={-8}
        schSectionName="gnss"
      />
      <TF_01A
        name="J_SD"
        schHeight={1.4}
        pcbX={13}
        pcbY={17}
        pcbRotation={180}
        schSectionName="storage"
      />
      <capacitor
        name="C_SD"
        capacitance="100nF"
        footprint="0402"
        pcbX={14}
        pcbY={9}
        schSectionName="storage"
      />
      <capacitor
        name="C_SD_BULK"
        capacitance="47uF"
        footprint="1206"
        pcbX={10}
        pcbY={6}
        schSectionName="storage"
      />
      {[
        ["R_SD_CS", 18, 8],
        ["R_SD_MISO", 21, 8],
        ["R_SD_D1", 21, 5],
        ["R_SD_D2", 18, 5],
        ["R_SD_CD", 24, 5],
      ].map(([name, x, y]) => (
        <resistor
          key={name}
          name={String(name)}
          pcbX={Number(x)}
          pcbY={Number(y)}
          resistance="47k"
          footprint="0402"
          schSectionName="storage"
        />
      ))}
      <resistor
        name="R_SD_CLK"
        resistance="33"
        footprint="0402"
        pcbX={-4}
        pcbY={3}
        schSectionName="storage"
      />
      <PCF85063ATL_1_118
        name="U_RTC"
        schHeight={1.2}
        pcbX={7}
        pcbY={-7}
        schSectionName="rtc"
      />
      <crystal
        name="Y_RTC"
        frequency="32.768kHz"
        loadCapacitance="7pF"
        footprint="res_p2.5mm_pw1mm_ph1.5mm"
        pcbX={7}
        pcbY={-11}
        schSectionName="rtc"
      />
      <capacitor
        name="C_RTC"
        capacitance="100nF"
        footprint="0402"
        pcbX={10}
        pcbY={-7}
        schSectionName="rtc"
      />
      {[
        ["R_SDA", 7, -3],
        ["R_SCL", 10, -3],
        ["R_RTC_INT", 13, -3],
      ].map(([name, x, y]) => (
        <resistor
          key={name}
          name={String(name)}
          pcbX={Number(x)}
          pcbY={Number(y)}
          resistance="4.7k"
          footprint="0402"
          schSectionName="rtc"
        />
      ))}
      <MCP73831T_2ACI_OT
        name="U_CHG"
        schHeight={0.6}
        pcbX={28}
        pcbY={10}
        schSectionName="charge"
      />
      <S2B_PH_SM4_TB_LF__SN_
        name="J_BAT"
        pcbX={27}
        pcbY={23}
        pcbRotation={0}
        schSectionName="charge"
      />
      <chip
        name="Q_LOAD"
        schHeight={0.4}
        manufacturerPartNumber="AO3401A"
        footprint="sot23"
        pinLabels={{ pin1: "G", pin2: "S", pin3: "D" }}
        pcbX={27}
        pcbY={3}
        schSectionName="charge"
      />
      <resistor
        name="R_GATE"
        resistance="100k"
        footprint="0402"
        pcbX={31}
        pcbY={3}
        schSectionName="charge"
      />
      <resistor
        name="R_PROG"
        resistance="10k"
        footprint="0402"
        pcbX={31}
        pcbY={8}
        schSectionName="charge"
      />
      <capacitor
        name="C_CHG_IN"
        capacitance="4.7uF"
        footprint="0603"
        pcbX={24}
        pcbY={12}
        schSectionName="charge"
      />
      <capacitor
        name="C_BAT"
        capacitance="4.7uF"
        footprint="0603"
        pcbX={31}
        pcbY={13}
        schSectionName="charge"
      />
      <capacitor
        name="C_SYS"
        capacitance="10uF"
        footprint="0805"
        pcbX={27}
        pcbY={-1}
        schSectionName="charge"
      />
      <resistor
        name="R_CHARGE"
        resistance="2.2k"
        footprint="0402"
        pcbX={25}
        pcbY={6}
        schSectionName="charge"
      />
      <led
        name="D_CHARGE"
        color="orange"
        footprint="0603"
        pcbX={31}
        pcbY={-2}
        schSectionName="charge"
      />
      <LogButton />
      <resistor
        name="R_LOG"
        resistance="10k"
        footprint="0402"
        pcbX={6}
        pcbY={-19}
        schSectionName="controls"
      />
      <led
        name="D_FIX"
        color="green"
        footprint="0603"
        pcbX={12}
        pcbY={-23}
        schSectionName="controls"
      />
      <resistor
        name="R_FIX"
        resistance="1k"
        footprint="0402"
        pcbX={12}
        pcbY={-19}
        schSectionName="controls"
      />
      <resistor
        name="R_BAT_HI"
        resistance="100k"
        footprint="0402"
        pcbX={-2}
        pcbY={-17}
        schSectionName="controls"
      />
      <resistor
        name="R_BAT_LO"
        resistance="100k"
        footprint="0402"
        pcbX={1}
        pcbY={-17}
        schSectionName="controls"
      />
      <capacitor
        name="C_BAT_ADC"
        capacitance="100nF"
        footprint="0402"
        pcbX={1}
        pcbY={-14}
        schSectionName="controls"
      />
      {Object.entries(nets).flatMap(([net, pins]) =>
        pins.map((pin) => (
          <trace key={`${net}-${pin}`} from={pin} to={`net.${net}`} />
        )),
      )}
      <copperpour
        connectsTo="net.GND"
        layer="bottom"
        clearance={0.2}
        boardEdgeMargin={0.4}
        useThermalReliefs
      />
      <copperpour
        connectsTo="net.GND"
        layer="top"
        clearance={0.2}
        boardEdgeMargin={0.4}
        useThermalReliefs
      />
      {[
        [31, -20],
        [31, -10],
        [16, -20],
        [16, -10],
        [-25, 0],
        [0, 0],
        [0, 12],
        [24, 0],
      ].map(([x, y], i) => (
        <Fragment key={i}>
          <via
            name={`GND_STITCH_${i}`}
            pcbX={x}
            pcbY={y}
            holeDiameter={0.3}
            outerDiameter={0.6}
            fromLayer="top"
            toLayer="bottom"
            connectsTo="net.GND"
          />
        </Fragment>
      ))}
      <pcbnoterect
        pcbX={-10.534003438860754}
        pcbY={-5.472430517590865}
        width={1.5}
        height={1.5}
        strokeWidth={0.12}
        color="#00ffff"
      />
      <pcbnoteline
        x1={-18}
        y1={-10}
        x2={-10.534003438860754}
        y2={-5.472430517590865}
        strokeWidth={0.12}
        color="#00ffff"
      />
      <pcbnotetext
        text="XIN / GND SHORT"
        pcbX={-23}
        pcbY={-11}
        fontSize={0.9}
        color="#00ffff"
      />
      <silkscreentext
        text="GPS LOGGER / RP2040"
        pcbX={-14}
        pcbY={-20}
        fontSize={1}
      />
      <silkscreentext text="PASSIVE GNSS" pcbX={24} pcbY={-24} fontSize={0.8} />
      <silkscreentext text="USB" pcbX={-10} pcbY={21} fontSize={0.8} />
      <silkscreentext text="LiPo 1S" pcbX={28} pcbY={18} fontSize={0.8} />
      <silkscreentext text="LOG" pcbX={6} pcbY={-26} fontSize={0.8} />
    </board>,
  )
}

test("pipeline9 gps logger reproduces XIN to ground contact", async () => {
  const circuit = new RootCircuit()
  circuit.platform = { partsEngineDisabled: true }
  const phaseSolvers: AutoroutingPipelineSolver9_PreloadedTraceGraph[] = []

  circuit.add(
    <GpsLogger
      algorithmFn={async (input: SimpleRouteJson) => {
        const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
        const phaseIndex = phaseSolvers.length
        phaseSolvers.push(solver)
        await expect(convertSrjToGraphicsObject(input)).toMatchGraphicsSvg(
          import.meta.path,
          { svgName: `phase-${phaseIndex}-input` },
        )
        solver.solve()
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        const traces = solver.getOutputSimplifiedPcbTraces()
        await expect(
          getBugReportSnapshotSvg({
            inputSrj: input,
            srjWithPointPairs: solver.srjWithPointPairs!,
            routedTraces: traces,
          }),
        ).toMatchSvgSnapshot(import.meta.path, {
          svgName: `phase-${phaseIndex}-output`,
        })
        const events = new EventEmitter()
        return {
          input,
          isRouting: false,
          on: events.on.bind(events),
          start(): void {
            events.emit("complete", { type: "complete", traces })
          },
          stop(): void {},
          solveSync() {
            return traces
          },
        }
      }}
    />,
  )

  await circuit.renderUntilSettled()
  expect(phaseSolvers).toHaveLength(2)
  expect(phaseSolvers[0].getOutputSimplifiedPcbTraces()).toHaveLength(4)
  expect(phaseSolvers[1].getOutputSimplifiedPcbTraces().length).toBeGreaterThan(
    4,
  )
  const circuitJson = circuit.getCircuitJson()
  // Zero clearance isolates actual copper contact from spacing violations.
  const contacts = checkEachPcbTraceNonOverlapping(circuitJson, {
    minClearance: 0,
  })
  expect(contacts).toHaveLength(1)
  expect(contacts[0].center?.x).toBeCloseTo(-10.534003438860754, 5)
  expect(contacts[0].center?.y).toBeCloseTo(-5.472430517590865, 5)

  await expect(
    convertCircuitJsonToPcbSvg(circuitJson, {
      width: 1400,
      height: 1150,
      shouldDrawErrors: false,
      showPcbNotes: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "full-board" })
})
