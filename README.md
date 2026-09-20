# jev-lab

Four experiments stress-testing TypeSafe's Jev: calibration, bundle bias, label bias, and ensembling.

Build spec: [PLAN.md](PLAN.md). Results land here as each experiment completes.

## Setup

```bash
cp .env.example .env   # add TYPESAFE_API_KEY
npm install
npm test
npm run smoke          # 50 BoolQ items; second pass must be $0.00 from cache
```

Phase 0–1 (repo skeleton + `core/` harness) is in place. Experiment pages come next.
