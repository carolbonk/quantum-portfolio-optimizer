"""Black-Scholes deltas, QAOA portfolio selection and the exact classical baseline."""

import time
from dataclasses import dataclass
from itertools import combinations

import numpy as np
from scipy.stats import norm
from qiskit import QuantumCircuit
from qiskit.circuit.library import StatePreparation
from qiskit.quantum_info import SparsePauliOp
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
from qiskit_aer import AerSimulator
from qiskit_aer.primitives import SamplerV2
from qiskit_algorithms import QAOA
from qiskit_algorithms.optimizers import COBYLA
from qiskit_algorithms.utils import algorithm_globals
from qiskit_optimization import QuadraticProgram
from qiskit_optimization.converters import QuadraticProgramToQubo

MAX_ASSETS = 8
DELTA_SCALE = 20
SEED = 42
SHOTS = 2048

_PASS_MANAGER = generate_preset_pass_manager(optimization_level=1, backend=AerSimulator())


def call_delta(price, strike, years, rate, vol):
    """Black-Scholes delta of a European call."""
    d1 = (np.log(price / strike) + (rate + 0.5 * vol**2) * years) / (vol * np.sqrt(years))
    return norm.cdf(d1)


@dataclass
class Universe:
    tickers: list
    prices: np.ndarray
    strikes: np.ndarray
    returns: np.ndarray
    vols: np.ndarray
    deltas: np.ndarray

    def index(self, ticker):
        return self.tickers.index(ticker)


@dataclass
class Candidate:
    bitstring: str
    tickers: list
    probability: float
    feasible: bool


@dataclass
class Result:
    selected: list
    total_return: float
    total_delta: float
    feasible: bool
    qubits: int
    seconds: float
    convergence: list
    candidates: list
    classical_selected: list
    classical_return: float
    classical_seconds: float
    constraint_note: str


def build_universe(rows, years, rate):
    prices = np.array([r["price"] for r in rows], dtype=float)
    strikes = np.array([r["strike"] for r in rows], dtype=float)
    vols = np.array([r["vol"] for r in rows], dtype=float)
    return Universe(
        tickers=[r["ticker"] for r in rows],
        prices=prices,
        strikes=strikes,
        returns=np.array([r["ret"] for r in rows], dtype=float),
        vols=vols,
        deltas=call_delta(prices, strikes, years, rate, vols),
    )


def classical_optimum(u, budget, delta_limit):
    """Exhaustive search over every portfolio of `budget` assets."""
    start = time.perf_counter()
    best, best_return = None, -np.inf
    for combo in combinations(range(len(u.tickers)), budget):
        idx = list(combo)
        if delta_limit is not None and u.deltas[idx].sum() > delta_limit + 1e-9:
            continue
        total = u.returns[idx].sum()
        if total > best_return:
            best, best_return = idx, total
    seconds = time.perf_counter() - start
    if best is None:
        return [], float("nan"), seconds
    return [u.tickers[i] for i in best], float(best_return), seconds


def _delta_constraint(u, budget, delta_limit):
    """Shift deltas by their minimum so the slack register needs as few qubits as possible.

    With exactly `budget` assets held, sum(d_i x_i) <= L  <=>  sum((d_i - d_min) x_i) <= L - budget * d_min.
    Returns (coefficients, rhs) or None when the limit can never bind.
    """
    d_min = u.deltas.min()
    shifted = np.round((u.deltas - d_min) * DELTA_SCALE).astype(int)
    rhs = int(np.floor((delta_limit - budget * d_min) * DELTA_SCALE + 1e-9))
    if rhs >= np.sort(shifted)[-budget:].sum():
        return None
    return shifted, rhs


def dicke_state(n, k):
    """Equal superposition of every n-bit string with exactly k ones."""
    amps = np.array([bin(i).count("1") == k for i in range(2**n)], dtype=float)
    return amps / np.linalg.norm(amps)


def weight_preserving_ansatz(n_assets, n_slack, budget):
    """Initial state and mixer that keep exactly `budget` asset qubits set (ring XY mixer).

    Slack qubits start in |+> and use the standard X mixer.
    """
    total = n_assets + n_slack
    init = QuantumCircuit(total)
    init.append(StatePreparation(dicke_state(n_assets, budget)), range(n_assets))
    if n_slack:
        init.h(range(n_assets, total))

    terms = []
    pairs = [(i, (i + 1) % n_assets) for i in range(n_assets if n_assets > 2 else 1)]
    for a, b in pairs:
        terms += [("XX", [a, b], 0.5), ("YY", [a, b], 0.5)]
    terms += [("X", [q], 1.0) for q in range(n_assets, total)]
    return init, SparsePauliOp.from_sparse_list(terms, num_qubits=total)


def optimize(u, budget, reps, delta_limit):
    """Select `budget` assets maximising expected return with QAOA, optionally under a delta cap."""
    classical_selected, classical_return, classical_seconds = classical_optimum(u, budget, delta_limit)
    if not classical_selected:
        lowest = np.sort(u.deltas)[:budget].sum()
        return None, (
            f"No portfolio of {budget} assets can stay under a delta of {delta_limit:.2f}: "
            f"the {budget} lowest deltas already sum to {lowest:.2f}."
        )

    qp = QuadraticProgram("delta_hedged_portfolio")
    for t in u.tickers:
        qp.binary_var(t)
    # Exactly `budget` assets are held, so shifting every return by a constant keeps the optimum.
    # Standardising them gives QAOA a well-conditioned landscape with O(1) differences.
    z = (u.returns - u.returns.mean()) / max(u.returns.std(), 1e-9)
    qp.minimize(linear={t: -float(z[i]) for i, t in enumerate(u.tickers)})
    qp.linear_constraint({t: 1 for t in u.tickers}, "==", budget, "budget")

    note = "Delta constraint off."
    if delta_limit is not None:
        constraint = _delta_constraint(u, budget, delta_limit)
        if constraint is None:
            note = f"Delta cap {delta_limit:.2f} never binds for {budget} assets, so it was dropped (fewer qubits)."
        else:
            coeffs, rhs = constraint
            qp.linear_constraint({t: int(coeffs[i]) for i, t in enumerate(u.tickers)}, "<=", max(rhs, 0), "delta")
            note = f"Delta cap {delta_limit:.2f} enforced through a slack register."

    qubo = QuadraticProgramToQubo().convert(qp)
    operator, _ = qubo.to_ising()
    qubits = qubo.get_num_vars()
    n = len(u.tickers)
    initial_state, mixer = weight_preserving_ansatz(n, qubits - n, budget)

    convergence = []
    algorithm_globals.random_seed = SEED
    qaoa = QAOA(
        sampler=SamplerV2(default_shots=SHOTS, seed=SEED),
        optimizer=COBYLA(maxiter=200),
        reps=reps,
        initial_state=initial_state,
        mixer=mixer,
        transpiler=_PASS_MANAGER,
        callback=lambda count, params, value, meta: convergence.append(float(value)),
    )
    start = time.perf_counter()
    eigenstate = qaoa.compute_minimum_eigenvalue(operator).eigenstate
    seconds = time.perf_counter() - start

    # Qubit j is asset j and the remaining qubits are slack. Keys are little-endian bitstrings.
    merged = {}
    for key, prob in eigenstate.items():
        key = key if isinstance(key, str) else format(key, f"0{qubits}b")
        bits = key[::-1][:n]
        merged[bits] = merged.get(bits, 0.0) + float(prob)

    def candidate(bits, prob):
        idx = [j for j, b in enumerate(bits) if b == "1"]
        ok = len(idx) == budget and (delta_limit is None or u.deltas[idx].sum() <= delta_limit + 1e-9)
        return Candidate(bits, [u.tickers[j] for j in idx], prob, bool(ok))

    candidates = sorted((candidate(b, p) for b, p in merged.items()), key=lambda c: -c.probability)

    # Read-out: keep the best measured portfolio that satisfies every constraint.
    feasible = [c for c in candidates if c.feasible]
    if feasible:
        selected = max(feasible, key=lambda c: u.returns[[u.index(t) for t in c.tickers]].sum()).tickers
    else:
        selected = candidates[0].tickers
    idx = [u.index(t) for t in selected]
    return Result(
        selected=selected,
        total_return=float(u.returns[idx].sum()),
        total_delta=float(u.deltas[idx].sum()),
        feasible=bool(feasible),
        qubits=qubits,
        seconds=seconds,
        convergence=convergence,
        candidates=candidates,
        classical_selected=classical_selected,
        classical_return=classical_return,
        classical_seconds=classical_seconds,
        constraint_note=note,
    ), ""
