"""Read existing CI evidence only; this script never runs a routing solver."""
import json
import collections
from pathlib import Path


def profile_summary(path):
    profile = json.loads(path.read_text())
    nodes = {node["id"]:node for node in profile["nodes"]}
    weights = collections.Counter()
    for index,node_id in enumerate(profile.get("samples",[])):
        delta = profile["timeDeltas"][index]
        frame = nodes[node_id]["callFrame"]
        key = (frame["functionName"],frame["url"],frame["lineNumber"]+1)
        weights[key] += delta/1000
    return [{"function":name,"url":url,"line":line,"sampleMs":ms} for (name,url,line),ms in weights.most_common(8)]


def read_run(root):
    rows=[]
    for process_file in sorted(root.rglob("process.json")):
        folder=process_file.parent
        process=json.loads(process_file.read_text())
        row={"case":folder.name,"process":process}
        progress=folder/"progress.json"
        replay=folder/"replay.json"
        diagnostics=folder/"diagnostics.json"
        profile=folder/"cpu.cpuprofile"
        if progress.exists():
            value=json.loads(progress.read_text())
            row["progress"]={key:value[key] for key in ["id","mode","status","renderCompleted","elapsedMs","phases","errors","stage","initialCopperElements","runtime"]}
        if replay.exists():row["replay"]=json.loads(replay.read_text())
        if diagnostics.exists():
            value=json.loads(diagnostics.read_text())
            row["diagnostics"]={key:value[key] for key in ["busLastState","pipelineLastState","phaseInputs"]}
            row["diagnostics"]["busStageMs"]=dict(sorted(value["busStageMs"].items(),key=lambda kv:-kv[1])[:8])
            row["diagnostics"]["timelineCount"]=len(value["timeline"])
        if profile.exists():row["cpuHot"]=profile_summary(profile)
        log=folder/"worker.log"
        if log.exists():row["workerLogTail"]=log.read_text()[-2500:]
        rows.append(row)
    return {"environment":json.loads((root/"environment.json").read_text()),"cases":rows}


result={"main":read_run(Path("artifact-main")),"corrected":read_run(Path("artifact-corrected"))}
Path("summary.json").write_text(json.dumps(result,indent=2)+"\n")
print("ANALYSIS_SUMMARY_BEGIN")
print(json.dumps(result,separators=(",",":")))
print("ANALYSIS_SUMMARY_END")
