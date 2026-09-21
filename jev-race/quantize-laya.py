"""Build an int8 version of Laya. Kept as a documented negative result.

Dynamic int8 quantization stores Laya's weights as 8-bit integers instead of
32-bit floats: a quarter of the size (1.7 GB -> 425 MB). On CPUs with fast
int8 instructions (VNNI) that usually means a large speed-up.

Measured on an AMD Ryzen 5 5500U (Zen 2, no VNNI), 40 BoolQ questions,
6 threads each:
    stock fp32: median 856 ms, 32/40 correct
    int8:       median 747 ms, 26/40 correct   (1.15x faster, 6 points worse)
It disagreed with stock Laya on 12 of 40 verdicts. Not worth it on this
hardware, so jev-race does not race it. It may be worth re-measuring on a
CPU with VNNI (recent Intel, or AMD Zen 4 and later).

Reads the stock ONNX bundle that @receptron/laya downloaded (default cache
~/.cache/receptron-laya, override with LAYA_CACHE) and writes a complete
bundle to models/laya-int8/, which core/providers.js loads.

Usage (one time, from the repo root):
    .venv-von/Scripts/python jev-race/quantize-laya.py      (Windows)
    .venv-von/bin/python jev-race/quantize-laya.py          (macOS/Linux)
"""
import os
import shutil
import sys
from pathlib import Path

import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic

ROOT = Path(__file__).resolve().parent.parent
cache = Path(os.environ.get("LAYA_CACHE", Path.home() / ".cache" / "receptron-laya"))
src = cache / "receptron--laya-onnx" / "main"
dst = ROOT / "models" / "laya-int8"

if not (src / "laya.onnx").exists():
    sys.exit(f"Stock Laya bundle not found at {src}. Run `npm run race` once first so it downloads.")

dst.mkdir(parents=True, exist_ok=True)

# The exported graph carries a stale intermediate shape annotation (one
# tensor is annotated 256 wide but is actually 1028), which makes the
# quantizer's mandatory shape-inference pass fail. Drop the stored
# intermediate annotations and let inference recompute them from scratch.
# Inputs, outputs and weights are untouched.
tmp = dst / "_clean"
tmp.mkdir(exist_ok=True)
print("Loading stock model and clearing stale shape annotations...", flush=True)
model = onnx.load(str(src / "laya.onnx"))
del model.graph.value_info[:]
onnx.save_model(model, str(tmp / "laya.onnx"), save_as_external_data=True,
                all_tensors_to_one_file=True, location="laya.onnx.data")
del model

print(f"Quantizing -> {dst / 'laya.onnx'} (int8, dynamic)...", flush=True)
quantize_dynamic(
    model_input=str(tmp / "laya.onnx"),
    model_output=str(dst / "laya.onnx"),
    weight_type=QuantType.QInt8,
    use_external_data_format=True,
)
shutil.rmtree(tmp)

# The rest of the bundle (config + tokenizer) is unchanged.
shutil.copy2(src / "laya_config.json", dst / "laya_config.json")
shutil.copytree(src / "tokenizer", dst / "tokenizer", dirs_exist_ok=True)

for f in sorted(dst.rglob("*")):
    if f.is_file():
        print(f"  {f.relative_to(dst)}  {f.stat().st_size / 1e6:.1f} MB")
print("Done.")
