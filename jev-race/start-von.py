"""Start the local Von server for jev-race.

Von and Laya both run on this machine's CPU, and in a race they run at the
same moment. Left alone, each grabs every core and they slow each other
down unevenly. This caps Von at half the CPU threads, the same half Laya's
worker uses (core/laya-worker.js), so the two local racers split the
machine evenly. Override with VON_THREADS.

Binds 127.0.0.1 only.
"""
import os
import sys

threads = os.environ.get("VON_THREADS") or str(max(2, (os.cpu_count() or 4) // 2))  # same half as Laya
os.environ.setdefault("OMP_NUM_THREADS", threads)
os.environ.setdefault("MKL_NUM_THREADS", threads)

import torch  # noqa: E402  (must come after the env vars above)

torch.set_num_threads(int(threads))
print(f"Von: using {threads} CPU threads", flush=True)

from von.cli import main  # noqa: E402

sys.argv = ["von", "serve", "--host", "127.0.0.1", "--port", "8000", "--backend", "modernbert", "--device", "cpu"]
main()
