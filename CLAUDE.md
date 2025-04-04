# Capacity Node Autorouter Development Guide

## Commands

- Build: `bun run build`
- Start development server: `bun run start`
- Run tests: `bun test`
- Run specific test: `bun test tests/svg.test.ts`
- Format code: `bunx @biomejs/biome format --write .`
- Lint code: `bunx @biomejs/biome format .`

## Code Style Guidelines

- Use **TypeScript** with strict typing enabled
- **Naming**: Use kebab-case for filenames, camelCase for variables/functions, PascalCase for classes/interfaces
- **Imports**: Organize imports according to Biome rules (auto-organized when formatting)
- **Components**: Create React components with proper type definitions
- **Error handling**: Use try/catch blocks for error handling, avoid throwing errors in utility functions
- **Formatting**: Use Biome for consistent formatting (2-space indentation, double quotes for JSX)
- **Comments**: Add meaningful comments for complex logic, avoid unnecessary comments
- **Export patterns**: Export classes/functions directly from their definition files

## Architecture

The codebase follows a modular architecture with solvers handling different aspects of autorouting. The main export is the `CapacityMeshSolver` which orchestrates the routing process.
