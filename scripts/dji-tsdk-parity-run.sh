#!/usr/bin/env bash
# Side-by-side read-only DJI TSDK comparison on Raspberry Pi 5 using existing box64 wrapper.
# This script never changes the running SDK service, media store, or Docker Compose setup.
set -Eeuo pipefail
root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
baseline="" candidate="" input="" report="" width="" height=""
p95="0.5" maximum="2" timeout_s="90"
emissivity="0.95" distance="5" humidity="70" ambient="25" reflection="23"
usage() {
  echo "Usage: bash scripts/dji-tsdk-parity-run.sh --baseline-sdk DIR --candidate-sdk DIR --input R-JPEG --width PIXELS --height PIXELS [--report new-file.json] [--p95-limit-k 0.5] [--max-limit-k 2] [--timeout 90] [--emissivity .95] [--distance 5] [--humidity 70] [--ambient 25] [--reflection 23]" >&2
  exit 2
}
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --baseline-sdk) baseline="$2";shift 2;;
    --candidate-sdk) candidate="$2";shift 2;;
    --input) input="$2";shift 2;;
    --width) width="$2";shift 2;;
    --height) height="$2";shift 2;;
    --report) report="$2";shift 2;;
    --p95-limit-k) p95="$2";shift 2;;
    --max-limit-k) maximum="$2";shift 2;;
    --timeout) timeout_s="$2";shift 2;;
    --emissivity) emissivity="$2";shift 2;;
    --distance) distance="$2";shift 2;;
    --humidity) humidity="$2";shift 2;;
    --ambient) ambient="$2";shift 2;;
    --reflection) reflection="$2";shift 2;;
    *) usage;;
  esac
done
[[ -n "$baseline" && -n "$candidate" && -n "$input" && -n "$width" && -n "$height" ]] || usage
[[ "$timeout_s" =~ ^[0-9]+$ && "$timeout_s" -ge 1 && "$timeout_s" -le 3600 ]] || usage
[[ "$(uname -m)" == "aarch64" ]] || { echo "FAIL: This runner targets native arm64 Raspberry Pi." >&2;exit 2; }
command -v docker >/dev/null || { echo "FAIL: Docker is required." >&2;exit 2; }
command -v node >/dev/null || { echo "FAIL: Node.js is required." >&2;exit 2; }
for sdk in "$baseline" "$candidate"; do
  [[ -f "$sdk/bin/dji_irp" ]] || { echo "FAIL: SDK missing bin/dji_irp: $sdk" >&2;exit 2; }
done
[[ -f "$input" ]] || { echo "FAIL: source R-JPEG missing" >&2;exit 2; }
[[ "$(realpath "$baseline")" != "$(realpath "$candidate")" ]] || { echo "FAIL: same SDK directories" >&2;exit 2; }
[[ -z "$report" || ! -e "$report" ]] || { echo "FAIL: report exists; no overwrite" >&2;exit 2; }

# Exact parameter limits from the active SkyHub backend; invalid input never runs a native SDK.
node - "$root" "$emissivity" "$distance" "$humidity" "$ambient" "$reflection" <<'NODE'
const {sdkParameters}=require(process.argv[2]+'/backend/thermal-sdk.js');
try{
  const names=['emissivity','distance','humidity','ambient','reflection'];
  const vals=process.argv.slice(3);
  sdkParameters(Object.fromEntries(names.map((k,i)=>[k,vals[i]])));
}catch(err){console.error('FAIL: invalid SDK parameters: '+err.message);process.exit(2);}
NODE
work="$(mktemp -d -t skyhub-tsdk-parity-XXXXXXXX)"
cleanup(){ rm -rf -- "$work"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -- "$work/baseline" "$work/candidate"
set -- ./dji_irp --source /input.JPG --action measure --output /output/temperatures.raw \
  --measurefmt float32 --emissivity "$emissivity" --distance "$distance" \
  --humidity "$humidity" --ambient "$ambient" --reflection "$reflection"
echo "Running baseline SDK in an isolated temporary container" >&2
bash "$root/scripts/dji-tsdk-run.sh" --timeout "$timeout_s" --sdk "$baseline" --input "$input" --output "$work/baseline" -- "$@"
echo "Running candidate SDK in an isolated temporary container" >&2
bash "$root/scripts/dji-tsdk-run.sh" --timeout "$timeout_s" --sdk "$candidate" --input "$input" --output "$work/candidate" -- "$@"
set -- node "$root/scripts/dji-tsdk-parity-audit.js" \
  --baseline "$work/baseline/temperatures.raw" --candidate "$work/candidate/temperatures.raw" \
  --source "$input" --width "$width" --height "$height" \
  --p95-limit-k "$p95" --max-limit-k "$maximum"
[[ -z "$report" ]] || set -- "$@" --report "$report"
"$@"
