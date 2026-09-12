import { loadAutorouterBindings, type AutorouterBindingsInput } from "../../../rust/autorouter-bindings/ts/index"

export async function loadHighDensityBindings(input: AutorouterBindingsInput): Promise<void> {
  await loadAutorouterBindings(input)
}
