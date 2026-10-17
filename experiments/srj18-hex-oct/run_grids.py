"""Run the same routing engine with paired grid configurations on pinned SRJ18."""
import argparse
import concurrent.futures
import json
import math
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--fine', action='store_true')
    parser.add_argument('--time-limit', type=float, default=60)
    args = parser.parse_args()
    factor = math.sqrt(math.sqrt(3)/2)
    configs = [('hex-p020','hex',.2),('oct-p020','oct',.2),('oct-density020','oct',.2*factor)]
    if args.fine:
        configs = [('hex-p010','hex',.1),('oct-density010','oct',.1*factor)]
    tasks = [(sample, *config) for sample in sorted(args.dataset.glob('sample*.json')) for config in configs]

    def run(task):
        sample, variant, grid, pitch = task
        output = ROOT / 'results' / variant / sample.name
        output.parent.mkdir(parents=True, exist_ok=True)
        command = ['bun',str(ROOT/'src/gridRouter.ts'),str(sample.resolve()),'--grid',grid,'--pitch',str(pitch),
                   '--clearance','0.1','--via-diameter','0.3','--time-limit',str(args.time_limit),'--out',str(output)]
        start = time.perf_counter()
        try:
            result = subprocess.run(command,capture_output=True,text=True,timeout=args.time_limit+20)
            if result.returncode:
                raise RuntimeError(result.stderr[-4000:])
            data = json.loads(output.read_text())
            data['experiment']['suiteConcurrency'] = args.workers
            data['experiment']['processWallMs'] = (time.perf_counter()-start)*1000
            output.write_text(json.dumps(data,indent=2))
            exp = data['experiment']
            print(variant,sample.stem,exp['status'],len(exp['completedConnectionNames']),round(exp['elapsedMs']),flush=True)
            (output.with_suffix('.log')).write_text(result.stdout+result.stderr)
        except Exception as error:
            data = json.loads(sample.read_text())
            data.update({'traces':[], 'experiment':{'status':'execution_failure','elapsedMs':(time.perf_counter()-start)*1000,
                'error':str(error),'config':{'grid':grid,'pitch':pitch,'timeLimit':args.time_limit},'suiteConcurrency':args.workers}})
            output.write_text(json.dumps(data,indent=2))
            print(variant,sample.stem,'EXECUTION_FAILURE',str(error)[:200],flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(run,tasks))


if __name__ == '__main__':
    main()
