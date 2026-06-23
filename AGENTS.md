# Capacity Node Autorouter Development Guide

## Commands

- Build: `bun run build`
- Start development server: `bun run start`
- Run tests: `bun test`
- Run specific test: `bun test tests/svg.test.ts`

> Don't format or lint the code.

## Validation Policy

- Run tests, builds, and focused checks locally by default.
- Use Blacksmith only for benchmark runs unless the user explicitly asks to use
  Blacksmith for another validation task.

## Code Style Guidelines

- Use **TypeScript** with strict typing enabled
- **Naming**: Use kebab-case for filenames, camelCase for variables/functions, PascalCase for classes/interfaces
- **Imports**: Organize imports according to Biome rules (auto-organized when formatting)
- **Components**: Create React components with proper type definitions
- **Error handling**: Use try/catch blocks for error handling, avoid throwing errors in utility functions
- **Formatting**: Use Biome for consistent formatting (2-space indentation, double quotes for JSX)
- **Comments**: Add meaningful comments for complex logic, avoid unnecessary comments
- **Export patterns**: Export classes/functions directly from their definition files
- Avoid over-abstraction. Prefer direct code until a helper removes real
  duplication or clarifies a genuinely complex operation.
- Do not create functions smaller than 6 lines.
- Define types near the start of new code so variables, function parameters,
  and return values have explicit types.
- Always define function return types in new code.
- Structure types so invalid states are not representable where practical.

## Architecture

The codebase follows a modular architecture with solvers handling different aspects of autorouting. The main export is the `AutoroutingPipelineSolver` which orchestrates the routing process and contains all the stages.
