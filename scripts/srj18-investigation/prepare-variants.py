import json
import subprocess
from pathlib import Path

base = '73f2a0c8a05a06d85e0ddf126cb903e3949523d6'
head = '0702b0aa5c9bf3304aae6dca14462787e174587d'
paths = [
    'lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts',
    'lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver.ts',
    'lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreloadedPortValidator.ts',
]
original = {p: subprocess.check_output(['git', 'show', f'{base}:{p}'], text=True) for p in paths}
changed = {p: subprocess.check_output(['git', 'show', f'{head}:{p}'], text=True) for p in paths}
variants = {'base': original, 'control': original, 'head': changed}
variants['guard'] = {**original, paths[0]: changed[paths[0]]}
variants['lazy'] = {**original, paths[1]: changed[paths[1]]}
factory = changed[paths[2]]
assert factory.count('return () => true') == 2
assert factory.count('}): PortValidator {') == 1
factory = factory.replace('}): PortValidator {', '}): PortValidator | undefined {')
factory = factory.replace('return () => true', 'return undefined')
variants['factory'] = {**changed, paths[0]: original[paths[0]], paths[2]: factory}
Path('source-variants.json').write_text(json.dumps(variants))
print('Prepared variants:', ', '.join(variants))
