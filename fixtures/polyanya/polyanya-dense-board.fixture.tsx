import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// Dense board with multiple components and 12 connections.
// Simulates a realistic PCB with resistors, caps, and ICs.
const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [
    // "MCU" — large central IC
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 6,
      height: 6,
      connectedTo: ["data0", "data1", "data2", "data3", "gpio0", "gpio1", "vcc", "gnd", "pwr", "led0", "led1"],
    },
    // "Resistor array" — top right
    {
      type: "rect",
      layers: ["top"],
      center: { x: 8, y: 5 },
      width: 2,
      height: 1,
      connectedTo: ["gpio0"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 8, y: 3 },
      width: 2,
      height: 1,
      connectedTo: ["gpio1"],
    },
    // "Caps" — bottom left decoupling
    {
      type: "rect",
      layers: ["top"],
      center: { x: -7, y: -4 },
      width: 1.5,
      height: 1,
      connectedTo: ["vcc"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: -7, y: -6 },
      width: 1.5,
      height: 1,
      connectedTo: ["gnd"],
    },
    // "Connector" — right edge
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 12, y: 0 },
      width: 2,
      height: 8,
      connectedTo: ["data0", "data1", "data2", "data3", "vbus"],
    },
    // "Voltage regulator" — top left
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -8, y: 5 },
      width: 3,
      height: 2,
      connectedTo: ["pwr", "vbus"],
    },
    // "LED cluster" — bottom right
    {
      type: "rect",
      layers: ["top"],
      center: { x: 7, y: -5 },
      width: 1,
      height: 1,
      connectedTo: ["led0"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 9, y: -5 },
      width: 1,
      height: 1,
      connectedTo: ["led1"],
    },
  ],
  connections: [
    // MCU to connector (4 data lines)
    {
      name: "data0",
      pointsToConnect: [
        { x: 3, y: 1.5, layer: "top" },
        { x: 11, y: 2, layer: "top" },
      ],
    },
    {
      name: "data1",
      pointsToConnect: [
        { x: 3, y: 0.5, layer: "top" },
        { x: 11, y: 1, layer: "top" },
      ],
    },
    {
      name: "data2",
      pointsToConnect: [
        { x: 3, y: -0.5, layer: "top" },
        { x: 11, y: -1, layer: "top" },
      ],
    },
    {
      name: "data3",
      pointsToConnect: [
        { x: 3, y: -1.5, layer: "top" },
        { x: 11, y: -2, layer: "top" },
      ],
    },
    // MCU to resistor array
    {
      name: "gpio0",
      pointsToConnect: [
        { x: 1.5, y: 3, layer: "top" },
        { x: 7, y: 5, layer: "top" },
      ],
    },
    {
      name: "gpio1",
      pointsToConnect: [
        { x: 0.5, y: 3, layer: "top" },
        { x: 7, y: 3, layer: "top" },
      ],
    },
    // MCU to decoupling caps
    {
      name: "vcc",
      pointsToConnect: [
        { x: -3, y: -1.5, layer: "top" },
        { x: -6.25, y: -4, layer: "top" },
      ],
    },
    {
      name: "gnd",
      pointsToConnect: [
        { x: -3, y: -2.5, layer: "top" },
        { x: -6.25, y: -6, layer: "top" },
      ],
    },
    // Voltage regulator to MCU
    {
      name: "pwr",
      pointsToConnect: [
        { x: -6.5, y: 5, layer: "top" },
        { x: -3, y: 1.5, layer: "top" },
      ],
    },
    // MCU to LEDs
    {
      name: "led0",
      pointsToConnect: [
        { x: 1.5, y: -3, layer: "top" },
        { x: 7, y: -5, layer: "top" },
      ],
    },
    {
      name: "led1",
      pointsToConnect: [
        { x: 2.5, y: -3, layer: "top" },
        { x: 9, y: -5, layer: "top" },
      ],
    },
    // Cross-board: vreg to connector (power)
    {
      name: "vbus",
      pointsToConnect: [
        { x: -8, y: 4, layer: "top" },
        { x: 11, y: 3, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -12, maxX: 15, minY: -10, maxY: 10 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
