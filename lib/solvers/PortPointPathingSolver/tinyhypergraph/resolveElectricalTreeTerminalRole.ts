import type { ElectricalTreeTerminalWitness } from "./createElectricalTreeTerminalWitnesses"

type TerminalRoleInput = {
  connectionId: string
  netId: string
  expectedPcbPortIds: Array<string | undefined>
  pcbPortId: string
  position: { x: number; y: number; z: number }
  witness: ElectricalTreeTerminalWitness | undefined
  preloaded: boolean
}

/** A known same-net interior pad is a junction, not this pair's endpoint. */
export function resolveElectricalTreeTerminalRole(
  input: TerminalRoleInput,
): "endpoint" | "junction" {
  if (input.expectedPcbPortIds.includes(input.pcbPortId)) return "endpoint"
  const { witness, position } = input
  if (
    input.preloaded || !witness ||
    witness.connectionId === input.connectionId ||
    witness.netId !== input.netId || witness.pcbPortId !== input.pcbPortId ||
    witness.x !== position.x || witness.y !== position.y || witness.z !== position.z
  ) {
    throw new Error(
      `Electrical tree route "${input.connectionId}" has uncertified interior PCB terminal "${input.pcbPortId}"`,
    )
  }
  return "junction"
}
