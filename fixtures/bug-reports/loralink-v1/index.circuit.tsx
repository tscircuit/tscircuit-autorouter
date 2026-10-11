import { TYPE_C_31_M_12 } from "./imports/TYPE_C_31_M_12"
import { Fragment } from "react"
import { ESP32_C3_WROOM_02_N4 } from "./imports/ESP32_C3_WROOM_02_N4"
import { E22_900M22S } from "./imports/E22_900M22S"
import { SY8089AAAC } from "./imports/SY8089AAAC"
import { USBLC6_2SC6 } from "./imports/USBLC6_2SC6"
import { U_FL_R_SMT_1_80_ } from "./imports/U_FL_R_SMT_1_80_"
import { TS_1187A_B_A_B } from "./imports/TS_1187A_B_A_B"

function Notes({ x, y, lines }: { x: number; y: number; lines: string[] }) {
  return (
    <>
      {lines.map((text, i) => (
        <Fragment key={i}>
          <schematictext
            text={text}
            schX={x}
            schY={y - i * 0.38}
            fontSize={0.22}
            anchor="left"
            color="#526273"
          />
        </Fragment>
      ))}
    </>
  )
}

// Stage 1: explicit matched USB links. Stage 2: joint signal, power and ground routing.
// Clearance blockers are recorded in ISSUES.md; this is not a fabrication release.
// Passives without supplier numbers remain provisional until sourcing review.
export default function LoRaLinkV1({
  throughPhase = 2,
}: { throughPhase?: number } = {}) {
  return (
    <board
      autorouterEffortLevel="5x"
      nominalTraceWidth="0.2mm"
      width="60mm"
      height="35mm"
      layers={4}
      routeRemaining={false}
      minViaHoleDiameter="0.3mm"
      minViaPadDiameter="0.6mm"
      minViaEdgeToPadEdgeClearance="0.25mm"
      minBoardEdgeClearance="0.2mm"
      autorouter={{ traceClearance: 0.2 }}
      minTraceToPadEdgeClearance="0.15mm"
      schAutoLayoutEnabled
      title={`LoRaLink V1 | routing stage ${throughPhase}/2 — DRC review`}
    >
      {[-29.9, 29.9].map((x) => (
        <Fragment key={`edge-x-${x}`}>
          <keepout
            shape="rect"
            pcbX={x}
            width={0.2}
            height={35}
            layers={["top", "inner1", "inner2", "bottom"]}
            allowPlacements
          />
        </Fragment>
      ))}
      {[-17.4, 17.4].map((y) => (
        <Fragment key={`edge-y-${y}`}>
          <keepout
            shape="rect"
            pcbY={y}
            width={60}
            height={0.2}
            layers={["top", "inner1", "inner2", "bottom"]}
            allowPlacements
          />
        </Fragment>
      ))}
      {throughPhase >= 2 && (
        <autoroutingphase
          name="02-signals-power-and-ground"
          phaseIndex={1}
          minTraceWidth="0.2mm"
        />
      )}
      <trace
        name="USB_DM_SHORT"
        from=".U1 > .IO18"
        to=".R5 > .pin2"
        pcbPath={[]}
        thickness="0.25mm"
      />
      <trace
        name="USB_DP_SHORT"
        from=".U1 > .IO19"
        to=".R6 > .pin2"
        pcbPath={[]}
        thickness="0.25mm"
      />
      {/* Short MCU USB links are straight, equal-length top-layer routes. */}
      {/* Connector-side USB has multiple terminals; pair constraints require a topology review. See ISSUES.md. */}
      <differentialpair
        name="USB_MCU"
        positiveConnection="USB_DP_SHORT"
        negativeConnection="USB_DM_SHORT"
        maxLengthSkew="0.5mm"
        targetDifferentialImpedance="90ohm"
      />
      <copperpour
        name="GND_TOP"
        layer="top"
        connectsTo="net.GND"
        boardEdgeMargin="0.3mm"
        clearance="0.2mm"
      />
      <copperpour
        name="GND_L2"
        layer="inner1"
        connectsTo="net.GND"
        unbroken
        boardEdgeMargin="0.3mm"
        clearance="0.2mm"
      />
      <net
        name="GND"
        isGroundNet
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="VBUS"
        nominalTraceWidth="0.3mm"
        isPowerNet
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="V5_FUSED"
        nominalTraceWidth="0.3mm"
        isPowerNet
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="BUCK_SW"
        nominalTraceWidth="0.3mm"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="BUCK_FB"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="V3V3"
        nominalTraceWidth="0.3mm"
        isPowerNet
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net name="CC1" routingPhaseIndex={throughPhase >= 2 ? 1 : undefined} />
      <net name="CC2" routingPhaseIndex={throughPhase >= 2 ? 1 : undefined} />
      <net
        name="USB_DP"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="USB_DM"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="ESP_EN"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="BOOT_N"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="STRAP8"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="STRAP2"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net name="USB_DM_MCU" />
      <net name="USB_DP_MCU" />
      <net
        name="LORA_SCK"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_MISO"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_MOSI"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_NSS"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_BUSY"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_DIO1"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_RESET_N"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_RXEN"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="STATUS_LED"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="UART_TX"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net name="LED_A" routingPhaseIndex={throughPhase >= 2 ? 1 : undefined} />
      <net
        name="LORA_TXEN"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <net
        name="LORA_RF"
        routingPhaseIndex={throughPhase >= 2 ? 1 : undefined}
      />
      <schematicsheet
        name="power"
        displayName="01 | USB-C and 3.3 V power"
        sheetWidth={420}
        sheetHeight={297}
        sheetIndex={0}
      >
        <schematicsection
          name="usb"
          displayName="USB-C sink / programming"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={-15}
          y={3.5}
          lines={[
            "J1 takes 5 V from a USB host and exposes native USB data.",
            "R1/R2: separate 5.1k sink pulldowns; no USB-PD negotiation.",
            "Both orientations share D+ and D-; SBU is intentionally unused.",
            "Shell returns to GND. Phone current budget remains to verify.",
            "USB_DP / USB_DM continue to R6 / R5 on sheet 02.",
          ]}
        />
        <schematicsection
          name="esd"
          displayName="USB ESD / input protection"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={0}
          y={3.8}
          lines={[
            "U4 clamps data-line ESD; pins 1/6 and 3/4 are paired channels.",
            "C1 bypasses VBUS. Keep protection near the connector in layout.",
            "F1 is a provisional fuse slot: rating, technology and MPN are open.",
            "ESD is not sustained overvoltage protection. Review VBUS surge,",
            "inrush and CC protection before freezing the power schematic.",
          ]}
        />
        <schematicsection
          name="buck"
          displayName="5 V to 3.3 V buck regulator"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={-15}
          y={-11}
          lines={[
            "U3 has EN tied high; L1/C3/C4 filter the switching output.",
            "R3/R4 set nominal 3.318 V: 0.6 x (1 + 453k/100k). Use 1% resistors.",
            "C5 is a provisional feed-forward capacitor across R3.",
            "L1 value follows the application circuit; footprint/MPN and saturation",
            "current, capacitor DC-bias derating and stability require power review.",
            "Hot-loop placement, thermal validation and routing are later phases.",
            "V3V3 supplies U1 on sheet 02 and U2 on sheet 03; TP2 is on sheet 04.",
          ]}
        />
      </schematicsheet>
      <schematicsheet
        name="mcu"
        displayName="02 | ESP32-C3 and boot controls"
        sheetWidth={420}
        sheetHeight={297}
        sheetIndex={1}
      >
        <schematicsection
          name="cpu"
          displayName="Wi-Fi / web server / native USB"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={-18}
          y={2.1}
          lines={[
            "U1 runs the local Wi-Fi chat server and controls the radio over SPI.",
            "GPIO18 = USB D-; GPIO19 = USB D+. R5/R6 go near U1 in layout.",
            "Module pin 19 (exposed pad) and pin 9 both connect to GND.",
            "C6/C7 provide local bulk and high-frequency supply bypassing.",
            "GPIO20/RXD is RXEN; UART receive is unavailable. Use native USB.",
            "GPIO21/TXD remains a log pad. Antenna keepout is a later phase.",
            "USB data comes from J1 / U4 on sheet 01; radio nets go to sheet 03.",
            "UART_TX, ESP_EN and BOOT_N are accessible on TP4 / TP5 / TP6 (04).",
          ]}
        />
        <schematicsection
          name="boot"
          displayName="Reset / boot strapping"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={4}
          y={-4}
          lines={[
            "SW1 RESET pulls EN low; R7/C8 provide a startup RC delay.",
            "Hold SW2 BOOT during reset to request USB download mode.",
            "R8 holds GPIO9 high normally. R9 holds GPIO8 high for download.",
            "GPIO2 has a pull-up and is not assigned to radio control.",
            "Verify startup timing against the actual regulator ramp later.",
          ]}
        />
        <schematicsection
          name="status"
          displayName="Firmware status indicator"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={-18}
          y={-10}
          lines={[
            "GPIO0 high lights D1 through R11; final LED part is pending.",
            "Firmware can show boot, Wi-Fi or message/ACK states here.",
            "This LED is not an independent power-good indicator.",
          ]}
        />
      </schematicsheet>
      <schematicsheet
        name="radio"
        displayName="03 | SX1262 radio and antenna"
        sheetWidth={420}
        sheetHeight={297}
        sheetIndex={2}
      >
        <schematicsection
          name="lora"
          displayName="E22-900M22S / SPI and RF control"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={-18}
          y={-3}
          lines={[
            "SPI: GPIO4 SCK / GPIO5 MISO / GPIO6 MOSI / GPIO7 NSS.",
            "GPIO10 reads BUSY; GPIO3 receives DIO1; GPIO1 resets U2.",
            "GPIO20 drives RXEN. DIO2 drives TXEN using SX1262 RF-switch mode.",
            "RX: RXEN high, TXEN low. TX: RXEN low, TXEN high. Never both high.",
            "R12/R13 hold NSS/reset inactive; R14/R15 hold RF enables low at boot.",
            "Pin 12 is GND in the v1.3 manual and footprint; the website conflicts.",
            "Confirm purchased module revision before layout. DIO3 controls its",
            "internal TCXO; voltage and startup configuration still need verification.",
            "LORA_* digital nets connect to U1 on sheet 02 and TP7-15 on sheet 04.",
          ]}
        />
        <schematicsection
          name="rf"
          displayName="Radio decoupling / antenna"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={1}
          y={1}
          lines={[
            "C9/C10 supply local radio current bursts; place beside VCC later.",
            "J2 is a proposed carrier U.FL connector from the ANT pad.",
            "Use one antenna feed only; verify module IPEX/pad variant first.",
            "The future RF trace needs 50-ohm geometry from the actual stackup.",
            "Keep Wi-Fi and LoRa antennas separate and away from switching fields.",
            "Antenna selection, RF ESD and matching review remain open.",
          ]}
        />
      </schematicsheet>
      <schematicsheet
        name="debug"
        displayName="04 | Bring-up access and phase gates"
        sheetWidth={420}
        sheetHeight={297}
        sheetIndex={3}
      >
        <schematicsection
          name="test"
          displayName="Bring-up: power first, then digital signals"
          sectionTitleFontSize={0.32}
        />

        <Notes
          x={-15}
          y={-5}
          lines={[
            "Top row: TP3 GND / TP1 VBUS / TP2 V3V3 / TP16 GND (sheet 01).",
            "TP4 is UART TX logging only (sheet 02); programming uses native USB.",
            "TP5/6 expose reset/boot (02). TP7-15 expose radio SPI/control (03).",
            "TP16 provides a second ground reference. Pads are bare top copper.",
            "Probe USB at J1/R5/R6; no dedicated USB stubs are planned.",
          ]}
        />
        <Notes
          x={-15}
          y={-8}
          lines={[
            "ROUTING: matched MCU USB links, then one named joint routing phase.",
            "NEXT: BOM ratings, USB current limits, input protection and module revision.",
            "OPEN: copper DRC failures; see ISSUES.md and ROUTING.md for evidence.",
            "60 x 35 mm / four layers / top SMT. Placement checks pass; RF review is open.",
            "Do not order from this phase. Stock and assembly availability are open.",
          ]}
        />
      </schematicsheet>

      <TYPE_C_31_M_12
        schSheetName="power"
        name="J1"
        pcbX={-24}
        pcbY={-11.5}
        pcbRotation={0}
        schSectionName="usb"
        schX={-12}
        schY={7}
        noConnect={["SBU1", "SBU2"]}
        connections={{
          VBUS1: "net.VBUS",
          VBUS2: "net.VBUS",
          GND1: "net.GND",
          GND2: "net.GND",
          SHELL1: "net.GND",
          SHELL2: "net.GND",
          SHELL3: "net.GND",
          SHELL4: "net.GND",
          CC1: "net.CC1",
          CC2: "net.CC2",
          DP1: "net.USB_DP",
          DP2: "net.USB_DP",
          DM1: "net.USB_DM",
          DM2: "net.USB_DM",
        }}
      />
      <resistor
        schRotation={-90}
        schSheetName="power"
        name="R1"
        pcbX={-26}
        pcbY={-7}
        pcbRotation={180}
        resistance="5.1k"
        footprint="0603"
        schSectionName="usb"
        schX={-7}
        schY={9}
        connections={{ pin1: "net.CC1", pin2: "net.GND" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="power"
        name="R2"
        pcbX={-21.5}
        pcbY={-7.2}
        pcbRotation={0}
        resistance="5.1k"
        footprint="0603"
        schSectionName="usb"
        schX={-7}
        schY={6}
        connections={{ pin1: "net.CC2", pin2: "net.GND" }}
      />
      <USBLC6_2SC6
        schSheetName="power"
        name="U4"
        pcbX={-24}
        pcbY={-4}
        pcbRotation={0}
        schSectionName="esd"
        schX={3}
        schY={8}
        connections={{
          pin1: "net.USB_DP",
          pin6: "net.USB_DP",
          pin3: "net.USB_DM",
          pin4: "net.USB_DM",
          pin2: "net.GND",
          pin5: "net.VBUS",
        }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="power"
        name="C1"
        pcbX={-27}
        pcbY={-1}
        pcbRotation={90}
        capacitance="100nF"
        maxVoltageRating="16V"
        footprint="0603"
        schSectionName="esd"
        schX={8}
        schY={9}
        connections={{ pin1: "net.VBUS", pin2: "net.GND" }}
      />
      <fuse
        schRotation={-90}
        schSheetName="power"
        name="F1"
        pcbX={-17}
        pcbY={-10}
        pcbRotation={90}
        currentRating="750mA"
        voltageRating="16V"
        footprint="1206"
        schSectionName="esd"
        schX={8}
        schY={6}
        connections={{ pin1: "net.VBUS", pin2: "net.V5_FUSED" }}
      />
      <SY8089AAAC
        schSheetName="power"
        name="U3"
        pcbX={-13}
        pcbY={-5}
        pcbRotation={0}
        schSectionName="buck"
        schX={-10}
        schY={-5}
        schPinArrangement={{
          leftSide: ["IN", "EN"],
          rightSide: ["LX", "FB"],
          bottomSide: ["GND"],
        }}
        connections={{
          IN: "net.V5_FUSED",
          EN: "net.V5_FUSED",
          GND: "net.GND",
          LX: "net.BUCK_SW",
          FB: "net.BUCK_FB",
        }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="power"
        name="C2"
        pcbX={-17}
        pcbY={-4}
        pcbRotation={90}
        capacitance="22uF"
        maxVoltageRating="10V"
        footprint="0805"
        schSectionName="buck"
        schX={-15}
        schY={-4}
        connections={{ pin1: "net.V5_FUSED", pin2: "net.GND" }}
      />
      <inductor
        schSheetName="power"
        name="L1"
        pcbX={-8}
        pcbY={-4}
        pcbRotation={0}
        inductance="2.2uH"
        footprint="1210"
        schSectionName="buck"
        schX={-5}
        schY={-3}
        connections={{ pin1: "net.BUCK_SW", pin2: "net.V3V3" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="power"
        name="C3"
        pcbX={-6}
        pcbY={-9}
        pcbRotation={90}
        capacitance="22uF"
        maxVoltageRating="10V"
        footprint="0805"
        schSectionName="buck"
        schX={0}
        schY={-3}
        connections={{ pin1: "net.V3V3", pin2: "net.GND" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="power"
        name="C4"
        pcbX={-6}
        pcbY={-13}
        pcbRotation={270}
        capacitance="22uF"
        maxVoltageRating="10V"
        footprint="0805"
        schSectionName="buck"
        schX={1.3}
        schY={-3}
        connections={{ pin1: "net.V3V3", pin2: "net.GND" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="power"
        name="R3"
        pcbX={-14}
        pcbY={-9}
        pcbRotation={0}
        resistance="453k"
        footprint="0603"
        schSectionName="buck"
        schX={0}
        schY={-6}
        connections={{ pin1: "net.V3V3", pin2: "net.BUCK_FB" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="power"
        name="R4"
        pcbX={-14}
        pcbY={-12}
        pcbRotation={180}
        resistance="100k"
        footprint="0603"
        schSectionName="buck"
        schX={0}
        schY={-9}
        connections={{ pin1: "net.BUCK_FB", pin2: "net.GND" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="power"
        name="C5"
        pcbX={-11}
        pcbY={-10}
        pcbRotation={0}
        capacitance="22pF"
        maxVoltageRating="50V"
        footprint="0603"
        schSectionName="buck"
        schX={3}
        schY={-6}
        connections={{ pin1: "net.V3V3", pin2: "net.BUCK_FB" }}
      />
      <ESP32_C3_WROOM_02_N4
        schSheetName="mcu"
        name="U1"
        pcbX={-12}
        pcbY={10}
        pcbRotation={0}
        schWidth={1.52}
        schHeight={2.32}
        schSectionName="cpu"
        schX={-9}
        schY={7}
        connections={{
          "3V3": "net.V3V3",
          GND: "net.GND",
          pin19: "net.GND",
          EN: "net.ESP_EN",
          IO9: "net.BOOT_N",
          IO8: "net.STRAP8",
          IO2: "net.STRAP2",
          IO18: "net.USB_DM_MCU",
          IO19: "net.USB_DP_MCU",
          IO4: "net.LORA_SCK",
          IO5: "net.LORA_MISO",
          IO6: "net.LORA_MOSI",
          IO7: "net.LORA_NSS",
          IO10: "net.LORA_BUSY",
          IO3: "net.LORA_DIO1",
          IO1: "net.LORA_RESET_N",
          RXD: "net.LORA_RXEN",
          IO0: "net.STATUS_LED",
          TXD: "net.UART_TX",
        }}
      />
      <resistor
        schRotation={-90}
        schSheetName="mcu"
        name="R5"
        pcbX={0}
        pcbY={8.5}
        pcbRotation={180}
        resistance="22"
        footprint="0603"
        schSectionName="cpu"
        schX={-16}
        schY={7}
        connections={{ pin1: "net.USB_DM", pin2: "net.USB_DM_MCU" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="mcu"
        name="R6"
        pcbX={0}
        pcbY={10}
        pcbRotation={180}
        resistance="22"
        footprint="0603"
        schSectionName="cpu"
        schX={-16}
        schY={4}
        connections={{ pin1: "net.USB_DP", pin2: "net.USB_DP_MCU" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="mcu"
        name="C6"
        pcbX={-25}
        pcbY={12.5}
        pcbRotation={90}
        capacitance="10uF"
        maxVoltageRating="10V"
        footprint="0805"
        schSectionName="cpu"
        schX={-3}
        schY={9}
        connections={{ pin1: "net.V3V3", pin2: "net.GND" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="mcu"
        name="C7"
        pcbX={-25}
        pcbY={16}
        pcbRotation={0}
        capacitance="100nF"
        maxVoltageRating="16V"
        footprint="0603"
        schSectionName="cpu"
        schX={-1.7}
        schY={9}
        connections={{ pin1: "net.V3V3", pin2: "net.GND" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="mcu"
        name="R7"
        pcbX={-28}
        pcbY={10}
        pcbRotation={0}
        resistance="10k"
        footprint="0603"
        schSectionName="boot"
        schX={7}
        schY={10}
        connections={{ pin1: "net.V3V3", pin2: "net.ESP_EN" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="mcu"
        name="C8"
        pcbX={-25}
        pcbY={9}
        pcbRotation={0}
        capacitance="1uF"
        maxVoltageRating="10V"
        footprint="0603"
        schSectionName="boot"
        schX={12}
        schY={10}
        connections={{ pin1: "net.ESP_EN", pin2: "net.GND" }}
      />
      <TS_1187A_B_A_B
        schSheetName="mcu"
        name="SW1"
        pcbX={-1}
        pcbY={-4}
        pcbRotation={0}
        schSectionName="boot"
        schX={7}
        schY={6}
        internallyConnectedPins={[
          ["pin1", "pin2"],
          ["pin3", "pin4"],
        ]}
        connections={{
          pin1: "net.ESP_EN",
          pin2: "net.ESP_EN",
          pin3: "net.GND",
          pin4: "net.GND",
        }}
      />
      <TS_1187A_B_A_B
        schSheetName="mcu"
        name="SW2"
        pcbX={-1}
        pcbY={-12}
        pcbRotation={0}
        schSectionName="boot"
        schX={12}
        schY={6}
        internallyConnectedPins={[
          ["pin1", "pin2"],
          ["pin3", "pin4"],
        ]}
        connections={{
          pin1: "net.BOOT_N",
          pin2: "net.BOOT_N",
          pin3: "net.GND",
          pin4: "net.GND",
        }}
      />
      <resistor
        schRotation={-90}
        schSheetName="mcu"
        name="R8"
        pcbX={-25}
        pcbY={4}
        pcbRotation={0}
        resistance="10k"
        footprint="0603"
        schSectionName="boot"
        schX={12}
        schY={8}
        connections={{ pin1: "net.V3V3", pin2: "net.BOOT_N" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="mcu"
        name="R9"
        pcbX={-25}
        pcbY={6}
        pcbRotation={0}
        resistance="10k"
        footprint="0603"
        schSectionName="boot"
        schX={12}
        schY={2}
        connections={{ pin1: "net.V3V3", pin2: "net.STRAP8" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="mcu"
        name="R10"
        pcbX={0}
        pcbY={13}
        pcbRotation={180}
        resistance="10k"
        footprint="0603"
        schSectionName="boot"
        schX={7}
        schY={-1}
        connections={{ pin1: "net.V3V3", pin2: "net.STRAP2" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="mcu"
        name="R11"
        pcbX={4}
        pcbY={10}
        pcbRotation={90}
        resistance="1k"
        footprint="0603"
        schSectionName="status"
        schX={-12}
        schY={-7}
        connections={{ pin1: "net.STATUS_LED", pin2: "net.LED_A" }}
      />
      <led
        schRotation={-90}
        schSheetName="mcu"
        name="D1"
        pcbX={4}
        pcbY={13}
        pcbRotation={90}
        color="green"
        footprint="0603"
        schSectionName="status"
        schX={-7}
        schY={-7}
        connections={{ anode: "net.LED_A", cathode: "net.GND" }}
      />
      <E22_900M22S
        schSheetName="radio"
        name="U2"
        pcbX={19}
        pcbY={5}
        pcbRotation={0}
        schWidth={2.2}
        schHeight={2.8}
        schSectionName="lora"
        schX={-7}
        schY={7}
        schPinArrangement={{
          leftSide: [
            "SCK",
            "MOSI",
            "MISO",
            "NSS",
            "NRST",
            "BUSY",
            "DIO1",
            "RXEN",
          ],
          rightSide: ["ANT", "DIO2", "TXEN"],
          topSide: ["VCC"],
          bottomSide: [
            "GND1",
            "GND2",
            "GND3",
            "GND4",
            "GND5",
            "GND6",
            "GND7",
            "GND8",
            "GND9",
            "GND10",
          ],
        }}
        connections={{
          VCC: "net.V3V3",
          GND1: "net.GND",
          GND2: "net.GND",
          GND3: "net.GND",
          GND4: "net.GND",
          GND5: "net.GND",
          GND6: "net.GND",
          GND7: "net.GND",
          GND8: "net.GND",
          GND9: "net.GND",
          GND10: "net.GND",
          SCK: "net.LORA_SCK",
          MOSI: "net.LORA_MOSI",
          MISO: "net.LORA_MISO",
          NSS: "net.LORA_NSS",
          NRST: "net.LORA_RESET_N",
          BUSY: "net.LORA_BUSY",
          DIO1: "net.LORA_DIO1",
          RXEN: "net.LORA_RXEN",
          DIO2: "net.LORA_TXEN",
          TXEN: "net.LORA_TXEN",
          ANT: "net.LORA_RF",
        }}
      />
      <resistor
        schRotation={-90}
        schSheetName="radio"
        name="R12"
        pcbX={8}
        pcbY={10}
        pcbRotation={0}
        resistance="10k"
        footprint="0603"
        schSectionName="lora"
        schX={-14}
        schY={10}
        connections={{ pin1: "net.V3V3", pin2: "net.LORA_NSS" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="radio"
        name="R13"
        pcbX={8}
        pcbY={7}
        pcbRotation={0}
        resistance="10k"
        footprint="0603"
        schSectionName="lora"
        schX={-14}
        schY={7}
        connections={{ pin1: "net.V3V3", pin2: "net.LORA_RESET_N" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="radio"
        name="R14"
        pcbX={8}
        pcbY={4}
        pcbRotation={0}
        resistance="100k"
        footprint="0603"
        schSectionName="lora"
        schX={-14}
        schY={4}
        connections={{ pin1: "net.LORA_RXEN", pin2: "net.GND" }}
      />
      <resistor
        schRotation={-90}
        schSheetName="radio"
        name="R15"
        pcbX={8}
        pcbY={1}
        pcbRotation={0}
        resistance="100k"
        footprint="0603"
        schSectionName="lora"
        schX={-3}
        schY={4}
        connections={{ pin1: "net.LORA_TXEN", pin2: "net.GND" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="radio"
        name="C9"
        pcbX={29}
        pcbY={11}
        pcbRotation={90}
        capacitance="100nF"
        maxVoltageRating="16V"
        footprint="0603"
        schSectionName="rf"
        schX={4}
        schY={10}
        connections={{ pin1: "net.V3V3", pin2: "net.GND" }}
      />
      <capacitor
        schRotation={-90}
        schSheetName="radio"
        name="C10"
        pcbX={29}
        pcbY={7.4}
        pcbRotation={90}
        capacitance="10uF"
        maxVoltageRating="10V"
        footprint="0805"
        schSectionName="rf"
        schX={5.3}
        schY={10}
        connections={{ pin1: "net.V3V3", pin2: "net.GND" }}
      />
      <U_FL_R_SMT_1_80_
        schSheetName="radio"
        name="J2"
        pcbX={8}
        pcbY={-4.5}
        pcbRotation={0}
        schSectionName="rf"
        schX={7}
        schY={12}
        connections={{ SIG: "net.LORA_RF", GND1: "net.GND", GND2: "net.GND" }}
      />
      {[
        ["TP3", "GND"],
        ["TP1", "VBUS"],
        ["TP2", "V3V3"],
        ["TP16", "GND"],
        ["TP4", "UART_TX"],
        ["TP5", "ESP_EN"],
        ["TP6", "BOOT_N"],
        ["TP7", "LORA_SCK"],
        ["TP8", "LORA_MOSI"],
        ["TP9", "LORA_MISO"],
        ["TP10", "LORA_NSS"],
        ["TP11", "LORA_BUSY"],
        ["TP12", "LORA_DIO1"],
        ["TP13", "LORA_RESET_N"],
        ["TP14", "LORA_RXEN"],
        ["TP15", "LORA_TXEN"],
      ].map(([name, net], i) => (
        <testpoint
          schSheetName="debug"
          key={name}
          name={name}
          pcbX={8 + (i % 8) * 2.6}
          pcbY={-11 - Math.floor(i / 8) * 4}
          footprintVariant="pad"
          padShape="circle"
          padDiameter="1mm"
          doNotPlace
          schSectionName="test"
          schX={-12 + (i % 4) * 8}
          schY={11 - Math.floor(i / 4) * 4}
          connections={{ pin1: `net.${net}` }}
        />
      ))}
    </board>
  )
}
