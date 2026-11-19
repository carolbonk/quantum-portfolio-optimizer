"""FastAPI backend serving the dashboard and the QAOA optimisation API."""

import json
import threading
from functools import lru_cache
from math import comb
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from optimizer import MAX_ASSETS, build_universe, optimize
from presets import DEFAULT_PRESET, PRESETS

STATIC = Path(__file__).parent / "static"
_solver_lock = threading.Semaphore(2)

app = FastAPI(title="Quantum Portfolio Optimizer", docs_url="/api/docs", redoc_url=None)


class Asset(BaseModel):
    ticker: str = Field(min_length=1, max_length=8)
    price: float = Field(gt=0, le=1e6)
    strike: float = Field(gt=0, le=1e6)
    ret: float = Field(ge=-100, le=500, description="Expected annual return in %")
    vol: float = Field(gt=0, le=500, description="Annualised volatility in %")

    @field_validator("ticker")
    @classmethod
    def clean_ticker(cls, v):
        return v.strip().upper()


class OptimizeRequest(BaseModel):
    assets: list[Asset] = Field(min_length=2, max_length=MAX_ASSETS)
    budget: int = Field(ge=1, le=MAX_ASSETS)
    reps: int = Field(ge=1, le=4)
    delta_limit: float | None = Field(default=None, gt=0, le=10)
    expiry_months: float = Field(default=6, ge=1, le=36)
    rate: float = Field(default=2, ge=0, le=20, description="Risk-free rate in %")


@app.get("/api/presets")
def presets():
    return {"default": DEFAULT_PRESET, "max_assets": MAX_ASSETS, "presets": PRESETS}


@app.post("/api/optimize")
def run(req: OptimizeRequest):
    return json.loads(_cached_run(req.model_dump_json()))


@lru_cache(maxsize=256)
def _cached_run(payload: str) -> str:
    """Identical requests (e.g. the default view every visitor loads) reuse the previous result."""
    req = OptimizeRequest.model_validate_json(payload)
    tickers = [a.ticker for a in req.assets]
    if len(set(tickers)) != len(tickers):
        raise HTTPException(422, "Tickers must be unique.")
    if req.budget >= len(tickers):
        raise HTTPException(422, f"Portfolio size must be smaller than the {len(tickers)} assets in the universe.")

    rows = [{"ticker": a.ticker, "price": a.price, "strike": a.strike, "ret": a.ret / 100, "vol": a.vol / 100} for a in req.assets]
    u = build_universe(rows, req.expiry_months / 12, req.rate / 100)

    if not _solver_lock.acquire(timeout=60):
        raise HTTPException(503, "The optimizer is busy, please retry in a moment.")
    try:
        result, error = optimize(u, req.budget, req.reps, req.delta_limit)
    finally:
        _solver_lock.release()
    if error:
        raise HTTPException(422, error)

    matched = result.feasible and np.isclose(result.total_return, result.classical_return)
    ratio = result.total_return / result.classical_return if result.feasible and result.classical_return > 0 else None
    return json.dumps({
        "universe": [
            {"ticker": t, "ret": float(u.returns[i]), "vol": float(u.vols[i]), "delta": float(u.deltas[i]),
             "price": float(u.prices[i]), "strike": float(u.strikes[i]), "selected": t in result.selected}
            for i, t in enumerate(u.tickers)
        ],
        "selected": result.selected,
        "total_return": result.total_return,
        "total_delta": result.total_delta,
        "avg_vol": float(np.mean([u.vols[u.index(t)] for t in result.selected])) if result.selected else 0.0,
        "feasible": result.feasible,
        "qubits": result.qubits,
        "asset_qubits": len(tickers),
        "reps": req.reps,
        "seconds": result.seconds,
        "convergence": result.convergence,
        "candidates": [c.__dict__ for c in result.candidates if c in result.candidates[:12] or c.tickers == result.selected],
        "classical": {
            "selected": result.classical_selected,
            "total_return": result.classical_return,
            "seconds": result.classical_seconds,
            "portfolios_checked": comb(len(tickers), req.budget),
        },
        "matched_optimum": bool(matched),
        "approx_ratio": ratio,
        "delta_limit": req.delta_limit,
        "constraint_note": result.constraint_note,
    })


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
