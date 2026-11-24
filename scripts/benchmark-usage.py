"""Count recorded public MCP tool calls in completed QA runs, once per run and trace."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import re


KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parents[1]


def aggregate(runs, through_run=None):
    site = json.loads((ROOT / "release.config.json").read_bytes())["site"]["url"]
    daily, tools = Counter(), Counter()
    case_ids, sessions, moments = set(), [], []
    successful = 0
    for path in sorted(runs.glob("*/summary.json")):
        run_id = path.parent.name
        if through_run and run_id > through_run:
            continue
        raw = path.read_bytes()
        summary = json.loads(raw)
        if not re.fullmatch(r"\d{8}T\d{6}-(?:development|holdout)-[0-9a-f]+", run_id):
            raise ValueError("Unexpected session directory name")
        manifest = json.loads((path.parent / "manifest.json").read_bytes())
        if (summary["run_id"] != run_id or manifest["run_id"] != run_id
                or summary["endpoint"] != site + "/public-mcp" or summary["endpoint"] != manifest["endpoint"]
                or not summary.get("finished")):
            raise ValueError(f"Session identity or endpoint mismatch in {run_id}")
        expected = sorted(manifest["case_ids"])
        files = sorted((path.parent / "answers").glob("*.json"))
        if [p.stem for p in files] != expected or expected != sorted(summary["case_ids"]):
            raise ValueError(f"Case files differ from the session manifest in {run_id}")
        calls, answer_hash = 0, sha256()
        for file in files:
            data = file.read_bytes()
            row = json.loads(data)
            if row["case"]["id"] != file.stem:
                raise ValueError(f"Case identity mismatch in {run_id}")
            case_ids.add(file.stem)
            answer_hash.update(f"{file.stem} {sha256(data).hexdigest()}\n".encode("ascii"))
            for call in row["trace"]:
                started = datetime.fromisoformat(call["started"])
                tool = call["tool"]
                if (started.utcoffset() is None or type(call["ok"]) is not bool
                        or not re.fullmatch(r"[a-z][a-z0-9_]*", tool)):
                    raise ValueError(f"Invalid recorded call in {run_id}")
                moment = started.astimezone(KST)
                moments.append(moment)
                daily[moment.date().isoformat()] += 1
                tools[tool] += 1
                successful += call["ok"]
                calls += 1
        if calls != summary["calls"] or len(files) != summary["metrics"]["total"]:
            raise ValueError(f"Recorded call or case count differs from the session total in {run_id}")
        sessions.append({"run_id": run_id, "case_executions": len(files), "tool_calls": calls,
                         "summary_sha256": sha256(raw).hexdigest(), "answers_manifest_sha256": answer_hash.hexdigest()})
    if not moments or through_run and through_run not in {s["run_id"] for s in sessions}:
        raise ValueError("No recorded calls or the requested final session is missing")
    summary_index = "".join(f"{s['run_id']} {s['summary_sha256']}\n" for s in sessions)
    return {
        "schema_version": 1, "scope": "archived_benchmark_tool_calls", "time_zone": "Asia/Seoul",
        "first_call_at": min(moments).isoformat(), "last_call_at": max(moments).isoformat(),
        "totals": {"sessions": len(sessions), "distinct_cases": len(case_ids),
                   "case_executions": sum(s["case_executions"] for s in sessions), "tool_calls": len(moments),
                   "successful_tool_calls": successful, "failed_tool_calls": len(moments) - successful},
        "by_day": dict(sorted(daily.items())), "by_tool": dict(sorted(tools.items())),
        "summary_manifest_sha256": sha256(summary_index.encode("ascii")).hexdigest(), "sessions": sessions,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path, help="Directory containing the archived session folders")
    parser.add_argument("--through-run", help="Include sessions up to and including this run ID")
    parser.add_argument("--output", type=Path, help="Write UTF-8 JSON here (default: stdout)")
    args = parser.parse_args()
    report = json.dumps(aggregate(args.runs, args.through_run), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8", newline="\n")
    else:
        print(report, end="")
