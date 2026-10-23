import { expect, test } from "bun:test"
import { resolveElectricalTreeTerminalRole } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/resolveElectricalTreeTerminalRole"

test("interior PCB terminal export requires an immutable same-root pad witness", (): void => {
  const input = {
    connectionId: "D-A",
    netId: "bus",
    expectedPcbPortIds: ["D", "A"],
    pcbPortId: "C",
    position: { x: 40, y: 20, z: 0 },
    witness: {
      connectionId: "C-B",
      netId: "bus",
      pcbPortId: "C",
      x: 40,
      y: 20,
      z: 0,
    },
    preloaded: false,
  }
  expect(resolveElectricalTreeTerminalRole(input)).toBe("junction")
  expect(resolveElectricalTreeTerminalRole({
    ...input,
    pcbPortId: "A",
    witness: undefined,
  })).toBe("endpoint")
  const invalid = [
    { ...input, witness: undefined },
    { ...input, pcbPortId: "unknown" },
    { ...input, netId: "unrelated-root" },
    { ...input, witness: { ...input.witness, connectionId: "D-A" } },
    { ...input, witness: { ...input.witness, pcbPortId: "unknown" } },
    { ...input, position: { ...input.position, x: 40.01 } },
    { ...input, position: { ...input.position, y: 20.01 } },
    { ...input, position: { ...input.position, z: 1 } },
    { ...input, position: { ...input.position, x: Number.NaN } },
    { ...input, preloaded: true },
  ]
  for (const candidate of invalid) {
    expect(() => resolveElectricalTreeTerminalRole(candidate))
      .toThrow("uncertified interior PCB terminal")
  }
})
