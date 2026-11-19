const PALETTE = ["#10b981", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#fb7185", "#a3e635"];
const $ = (id) => document.getElementById(id);
const fmtPct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const state = { presets: {}, preset: null, assets: [], maxAssets: 8, reps: 2, tab: "dist", result: null };

/* ---------- Black-Scholes (mirrors optimizer.py for live previews) ---------- */
function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
function callDelta([, price, strike, , vol]) {
  const T = +$("expiry").value / 12, r = +$("rate").value / 100, s = vol / 100;
  if (!(price > 0 && strike > 0 && s > 0)) return NaN;
  return normCdf((Math.log(price / strike) + (r + 0.5 * s * s) * T) / (s * Math.sqrt(T)));
}
const sortedDeltas = () => state.assets.map(callDelta).filter(Number.isFinite).sort((a, b) => a - b);

/* ---------- controls ---------- */
function renderPresets() {
  $("presets").innerHTML = Object.keys(state.presets)
    .map((name) => `<button type="button" class="${name === state.preset ? "on" : ""}" data-name="${name}">${name}</button>`)
    .join("");
}

function loadPreset(name) {
  state.preset = name;
  state.assets = state.presets[name].map((row) => [...row]);
  renderPresets();
  renderRows();
  const n = state.assets.length;
  $("budget").value = Math.max(1, Math.round(n * 0.4));
  syncControls();
  const d = sortedDeltas(), k = +$("budget").value;
  const lo = d.slice(0, k).reduce((a, b) => a + b, 0), hi = d.slice(-k).reduce((a, b) => a + b, 0);
  $("delta").value = (Math.round(((lo + hi) / 2) * 20) / 20).toFixed(2);
  syncControls();
}

function renderRows() {
  $("asset-rows").innerHTML = state.assets
    .map((row, i) => `<tr data-i="${i}">
      <td><input aria-label="Ticker" data-c="0" value="${row[0]}" maxlength="8" /></td>
      ${[1, 2, 3, 4].map((c) => `<td><input aria-label="${["", "Price", "Strike", "Return %", "Volatility %"][c]}" data-c="${c}" type="number" step="any" value="${row[c]}" /></td>`).join("")}
      <td class="delta" data-delta></td>
      <td><button type="button" class="icon-btn" data-remove aria-label="Remove ${row[0]}">×</button></td>
    </tr>`)
    .join("");
  $("add-asset").disabled = state.assets.length >= state.maxAssets;
  $("asset-count").textContent = `${state.assets.length} / ${state.maxAssets} assets`;
}

function syncControls() {
  const n = state.assets.length, budget = $("budget");
  budget.max = Math.max(1, n - 1);
  if (+budget.value > +budget.max) budget.value = budget.max;
  $("budget-out").textContent = `${budget.value} of ${n}`;
  $("delta-out").textContent = (+$("delta").value).toFixed(2);
  $("expiry-out").textContent = `${$("expiry").value} mo`;
  $("rate-out").textContent = `${(+$("rate").value).toFixed(2)}%`;
  $("delta-box").style.opacity = $("use-delta").checked ? 1 : 0.35;
  $("delta").disabled = !$("use-delta").checked;

  document.querySelectorAll("#asset-rows tr").forEach((tr) => {
    const d = callDelta(state.assets[+tr.dataset.i]);
    tr.querySelector("[data-delta]").textContent = Number.isFinite(d) ? d.toFixed(2) : "—";
  });

  const d = sortedDeltas(), k = +budget.value, cap = +$("delta").value;
  const lo = d.slice(0, k).reduce((a, b) => a + b, 0), hi = d.slice(-k).reduce((a, b) => a + b, 0);
  const hint = $("delta-hint");
  hint.classList.toggle("bad", cap < lo || cap >= hi);
  hint.textContent = cap < lo
    ? `Infeasible: the ${k} lowest deltas already sum to ${lo.toFixed(2)}.`
    : cap >= hi
      ? `Never binds: even the ${k} highest deltas only sum to ${hi.toFixed(2)}.`
      : `Binding range for ${k} assets: ${lo.toFixed(2)} – ${hi.toFixed(2)}.`;
}

function bindControls() {
  $("presets").addEventListener("click", (e) => e.target.dataset.name && loadPreset(e.target.dataset.name));
  $("asset-rows").addEventListener("input", (e) => {
    const c = +e.target.dataset.c, i = +e.target.closest("tr").dataset.i;
    state.assets[i][c] = c === 0 ? e.target.value.toUpperCase() : parseFloat(e.target.value);
    state.preset = null;
    renderPresets();
    syncControls();
  });
  $("asset-rows").addEventListener("click", (e) => {
    if (!e.target.closest("[data-remove]") || state.assets.length <= 2) return;
    state.assets.splice(+e.target.closest("tr").dataset.i, 1);
    state.preset = null;
    renderPresets(); renderRows(); syncControls();
  });
  $("add-asset").addEventListener("click", () => {
    state.assets.push([`NEW${state.assets.length + 1}`, 100, 100, 10, 25]);
    state.preset = null;
    renderPresets(); renderRows(); syncControls();
  });
  ["budget", "delta", "expiry", "rate", "use-delta"].forEach((id) => $(id).addEventListener("input", syncControls));
  $("reps").addEventListener("click", (e) => {
    if (!e.target.dataset.v) return;
    state.reps = +e.target.dataset.v;
    $("reps").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
  });
  $("chart-tabs").addEventListener("click", (e) => {
    if (!e.target.dataset.tab) return;
    state.tab = e.target.dataset.tab;
    $("chart-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.target));
    renderChart();
  });
  $("run").addEventListener("click", run);
}

/* ---------- API ---------- */
async function run() {
  const btn = $("run");
  if (btn.classList.contains("busy")) return;
  btn.classList.add("busy");
  $("loading").hidden = false;
  $("error").textContent = "";
  try {
    const res = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assets: state.assets.map(([ticker, price, strike, ret, vol]) => ({ ticker, price, strike, ret, vol })),
        budget: +$("budget").value,
        reps: state.reps,
        delta_limit: $("use-delta").checked ? +$("delta").value : null,
        expiry_months: +$("expiry").value,
        rate: +$("rate").value,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      const d = body.detail;
      throw new Error(Array.isArray(d) ? d.map((x) => `${x.loc.slice(-2).join(" ")}: ${x.msg}`).join("; ") : d || res.statusText);
    }
    state.result = body;
    renderResult();
  } catch (err) {
    $("error").textContent = err.message;
  } finally {
    btn.classList.remove("busy");
    $("loading").hidden = true;
  }
}

/* ---------- results ---------- */
function countUp(el, to, format) {
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = format(to * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderResult() {
  const r = state.result, c = r.classical;
  const ok = r.matched_optimum;
  $("verdict").className = `verdict${ok ? "" : " warn"}`;
  $("verdict").innerHTML = ok
    ? `<div class="badge">✓</div><div><strong>QAOA found the exact optimum</strong><span>It matches the best of all ${c.portfolios_checked} portfolios checked classically.</span></div>`
    : r.feasible
      ? `<div class="badge">≈</div><div><strong>QAOA reached ${fmtPct(r.approx_ratio, 0)} of the optimum</strong><span>The exact search prefers ${c.selected.join(", ")}. Try more layers (p).</span></div>`
      : `<div class="badge">!</div><div><strong>QAOA's best sample breaks a constraint</strong><span>Add layers or loosen the delta cap. The exact optimum is ${c.selected.join(", ") || "infeasible"}.</span></div>`;

  const capPct = r.delta_limit ? Math.min(100, (r.total_delta / r.delta_limit) * 100) : 0;
  const kpis = [
    { label: "Expected return", v: r.total_return, f: (x) => fmtPct(x), foot: "sum of annual returns", accent: "linear-gradient(90deg,#34d399,#22d3ee)" },
    { label: "Portfolio Σ delta", v: r.total_delta, f: (x) => x.toFixed(3), foot: r.delta_limit ? `cap ${r.delta_limit.toFixed(2)}` : "no cap", meter: r.delta_limit ? capPct : null, over: r.delta_limit && r.total_delta > r.delta_limit },
    { label: "Avg volatility", v: r.avg_vol, f: (x) => fmtPct(x, 0), foot: "annualised", accent: "linear-gradient(90deg,#f472b6,#fbbf24)" },
    { label: "Qubits", v: r.qubits, f: (x) => Math.round(x), foot: `${r.asset_qubits} assets + ${r.qubits - r.asset_qubits} slack`, accent: "linear-gradient(90deg,#10b981,#f472b6)" },
    { label: "QAOA solve", v: r.seconds, f: (x) => `${x.toFixed(2)}s`, foot: `p = ${r.reps}, ${r.convergence.length} evaluations`, accent: "linear-gradient(90deg,#22d3ee,#10b981)" },
    { label: "Classical check", v: c.seconds * 1000, f: (x) => `${x.toFixed(2)}ms`, foot: `${c.portfolios_checked} portfolios, exhaustive`, accent: "linear-gradient(90deg,#64748b,#94a3b8)" },
  ];
  $("kpis").innerHTML = kpis
    .map((k, i) => `<div class="panel kpi" style="${k.accent ? `--accent:${k.accent}` : ""}"><div class="label">${k.label}</div><div class="value" data-k="${i}"></div><div class="foot">${k.foot}</div>${k.meter != null ? `<div class="meter${k.over ? " over" : ""}"><i style="width:0"></i></div>` : ""}</div>`)
    .join("");
  kpis.forEach((k, i) => countUp(document.querySelector(`[data-k="${i}"]`), k.v, k.f));
  requestAnimationFrame(() => document.querySelectorAll(".meter i").forEach((m) => (m.style.width = `${capPct}%`)));

  const color = (t) => PALETTE[r.universe.findIndex((u) => u.ticker === t) % PALETTE.length];
  $("holdings").innerHTML = r.selected
    .map((t, i) => {
      const u = r.universe.find((x) => x.ticker === t);
      return `<div class="holding" style="animation-delay:${i * 60}ms"><div class="avatar" style="background:linear-gradient(135deg,${color(t)},${color(t)}88)">${t.slice(0, 4)}</div>
        <div><div class="t">${t} <span class="muted small">${fmtPct(1 / r.selected.length, 0)}</span></div><div class="s">ret ${fmtPct(u.ret)} · Δ ${u.delta.toFixed(2)} · σ ${fmtPct(u.vol, 0)}</div></div></div>`;
    })
    .join("") || `<p class="muted">No assets selected.</p>`;

  renderInsight();
  renderChart();
}

function renderInsight() {
  const r = state.result, c = r.classical, slack = r.qubits - r.asset_qubits;
  const names = (xs) => xs.map((x) => `<b>${x}</b>`).join(", ");
  const paras = [
    `QAOA built a <b>${r.qubits}-qubit</b> circuit (${r.asset_qubits} asset qubits${slack ? ` + ${slack} slack qubits for the delta cap` : ""}) with <code>p = ${r.reps}</code> layers. COBYLA tuned its ${2 * r.reps} angles over ${r.convergence.length} circuit evaluations in ${r.seconds.toFixed(2)}s.`,
    r.matched_optimum
      ? `The best valid portfolio QAOA measured, ${names(r.selected)}, matches the exact optimum from checking all ${c.portfolios_checked} portfolios classically (${(c.seconds * 1000).toFixed(2)} ms).`
      : `QAOA returned ${names(r.selected)}, while the exhaustive search found ${names(c.selected)} with ${fmtPct(c.total_return)} expected return.`,
    `Portfolio delta is <b>${r.total_delta.toFixed(3)}</b>. If you hold one call per stock, the basket gains about <b>$${r.total_delta.toFixed(2)}</b> when every underlying rises $1.`,
  ];
  const minSel = Math.min(...r.universe.filter((u) => u.selected).map((u) => u.ret));
  const skipped = r.universe.filter((u) => !u.selected && u.ret > minSel).sort((a, b) => b.ret - a.ret)[0];
  if (skipped && r.delta_limit && r.matched_optimum) {
    paras.push(`<b>${skipped.ticker}</b> has a higher return (${fmtPct(skipped.ret)}), but its delta of ${skipped.delta.toFixed(2)} would push the basket past the ${r.delta_limit.toFixed(2)} cap, so it was left out.`);
  }
  paras.push(`<span class="muted">${r.constraint_note}</span>`);
  $("insight").innerHTML = paras.map((p) => `<p>${p}</p>`).join("");
}

/* ---------- charts ---------- */
const CAPTIONS = {
  dist: "How often each portfolio was measured from the optimised circuit. Cyan is QAOA's answer; grey breaks a constraint.",
  risk: "Every asset by call delta and expected return. Bubble size is volatility; selected assets are highlighted.",
  conv: "QUBO energy at each COBYLA step. Lower energy means better portfolios become more likely.",
  alloc: "Equal-weight allocation across the selected assets.",
  circuit: "QAOA ansatz: a Dicke state over exactly k assets, then p rounds of cost and XY-mixer layers, then measurement.",
};

const baseLayout = (extra = {}) => ({
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "Inter, system-ui, sans-serif", color: "#aab3cc", size: 12 },
  margin: { l: 56, r: 18, t: 16, b: 48 },
  xaxis: { gridcolor: "rgba(148,163,184,0.1)", zeroline: false, ...(extra.xaxis || {}) },
  yaxis: { gridcolor: "rgba(148,163,184,0.1)", zeroline: false, ...(extra.yaxis || {}) },
  showlegend: false,
  hoverlabel: { bgcolor: "#0d1226", bordercolor: "#10b981", font: { family: "Inter", color: "#e6e9f5" } },
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => !["xaxis", "yaxis"].includes(k))),
});

function renderChart() {
  const r = state.result;
  if (!r || !window.Plotly) return;
  $("chart-caption").textContent = CAPTIONS[state.tab];
  const isCircuit = state.tab === "circuit";
  $("circuit").hidden = !isCircuit;
  $("chart").style.display = isCircuit ? "none" : "block";
  if (isCircuit) return renderCircuit();

  const narrow = window.innerWidth < 640;
  let data, layout;
  if (state.tab === "dist") {
    const same = (c) => c.tickers.join() === r.selected.join();
    const cs = r.candidates.slice(0, narrow ? 8 : 12);
    const answer = r.candidates.find(same);
    if (answer && !cs.includes(answer)) cs[cs.length - 1] = answer;
    data = [{
      type: "bar", orientation: "h",
      x: cs.map((c) => c.probability), y: cs.map((c) => c.tickers.join(" + ") || "∅"),
      customdata: cs.map((c) => c.bitstring),
      marker: { color: cs.map((c) => (same(c) ? "#22d3ee" : c.feasible ? "#10b981" : "#334155")), line: { width: 0 } },
      hovertemplate: "%{y}<br>|%{customdata}⟩<br>p = %{x:.3f}<extra></extra>",
    }];
    layout = baseLayout({ margin: { l: narrow ? 110 : 170, r: 18, t: 10, b: 44 }, xaxis: { title: "probability", tickformat: ".0%" }, yaxis: { autorange: "reversed", automargin: true }, bargap: 0.35 });
  } else if (state.tab === "risk") {
    const u = r.universe;
    data = [{
      type: "scatter", mode: "markers+text",
      x: u.map((a) => a.delta), y: u.map((a) => a.ret * 100), text: u.map((a) => a.ticker), textposition: "top center",
      customdata: u.map((a) => a.vol * 100),
      marker: { size: u.map((a) => 16 + a.vol * 46), color: u.map((a, i) => (a.selected ? PALETTE[i % PALETTE.length] : "rgba(100,116,139,0.35)")), line: { color: u.map((a) => (a.selected ? "#fff" : "rgba(0,0,0,0)")), width: 1.5 } },
      textfont: { color: u.map((a) => (a.selected ? "#fff" : "#7c869f")) },
      hovertemplate: "<b>%{text}</b><br>Δ %{x:.3f}<br>return %{y:.1f}%<br>σ %{customdata:.0f}%<extra></extra>",
    }];
    const pad = (vals, frac) => { const lo = Math.min(...vals), hi = Math.max(...vals), d = (hi - lo || 1) * frac; return [lo - d, hi + d]; };
    layout = baseLayout({ xaxis: { title: "call delta", range: pad(u.map((a) => a.delta), 0.15) }, yaxis: { title: "expected return (%)", range: pad(u.map((a) => a.ret * 100), 0.35) } });
  } else if (state.tab === "conv") {
    data = [{ type: "scatter", mode: "lines", y: r.convergence, line: { color: "#22d3ee", width: 2.5, shape: "spline" }, hovertemplate: "step %{x}<br>energy %{y:.4f}<extra></extra>" }];
    layout = baseLayout({ xaxis: { title: "COBYLA evaluation" }, yaxis: { title: "QUBO energy" } });
  } else {
    data = [{ type: "pie", hole: 0.64, labels: r.selected, values: r.selected.map(() => 1), sort: false,
      marker: { colors: r.selected.map((t) => PALETTE[r.universe.findIndex((u) => u.ticker === t) % PALETTE.length]), line: { color: "#0b1022", width: 3 } },
      textinfo: "label+percent", textfont: { color: "#fff", size: 13 }, hovertemplate: "%{label}: %{percent}<extra></extra>" }];
    layout = baseLayout({ margin: { l: 10, r: 10, t: 10, b: 10 }, annotations: [{ text: `<b>${r.selected.length}</b><br>assets`, showarrow: false, font: { size: 18, color: "#e6e9f5" } }] });
  }
  Plotly.react("chart", data, layout, { displayModeBar: false, responsive: true });
}

function renderCircuit() {
  const r = state.result, n = r.qubits, p = r.reps;
  const labels = [...r.universe.map((u) => u.ticker), ...Array.from({ length: n - r.asset_qubits }, (_, i) => `s${i}`)];
  const rowH = 30, top = 24, left = 70, colW = 58, layerW = colW * 2 + 18;
  const width = left + colW + p * layerW + colW + 30, height = top * 2 + rowH * (n - 1);
  const y = (i) => top + i * rowH;
  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="JetBrains Mono, monospace" font-size="11">`;
  labels.forEach((l, i) => {
    svg += `<text x="${left - 12}" y="${y(i) + 4}" text-anchor="end" fill="${i < r.asset_qubits ? "#cbd5e1" : "#64748b"}">${l}</text>`;
    svg += `<line x1="${left}" x2="${width - 16}" y1="${y(i)}" y2="${y(i)}" stroke="rgba(148,163,184,0.35)" />`;
  });
  const gate = (x, i, text, fill) => `<rect x="${x}" y="${y(i) - 11}" width="${colW - 14}" height="22" rx="5" fill="${fill}" /><text x="${x + (colW - 14) / 2}" y="${y(i) + 4}" text-anchor="middle" fill="#fff">${text}</text>`;
  let x = left + 6;
  svg += `<rect x="${x}" y="${top - 14}" width="${colW - 14}" height="${top - 14 + rowH * (r.asset_qubits - 1) + 28}" rx="6" fill="#334155" stroke="#94a3b8" stroke-opacity=".5" />`;
  svg += `<text x="${x + (colW - 14) / 2}" y="${top + (rowH * (r.asset_qubits - 1)) / 2 + 4}" text-anchor="middle" fill="#fff" transform="rotate(-90 ${x + (colW - 14) / 2} ${top + (rowH * (r.asset_qubits - 1)) / 2})">Dicke k=${r.selected.length}</text>`;
  labels.slice(r.asset_qubits).forEach((_, j) => (svg += gate(x, r.asset_qubits + j, "H", "#475569")));
  x += colW;
  for (let k = 1; k <= p; k++) {
    svg += `<rect x="${x}" y="${top - 14}" width="${colW + 4}" height="${height - 2 * top + 28}" rx="8" fill="url(#gc)" stroke="#34d399" stroke-opacity=".6" />`;
    svg += `<text x="${x + (colW + 4) / 2}" y="${height / 2 + 4}" text-anchor="middle" fill="#fff" font-size="12">U<tspan font-size="9" dy="3">C</tspan><tspan dy="-3">(γ${k})</tspan></text>`;
    x += colW + 14;
    labels.forEach((_, i) => (svg += gate(x, i, i < r.asset_qubits ? `XY${k}` : `Rx${k}`, "#0e7490")));
    x += colW + 4;
  }
  labels.forEach((_, i) => {
    svg += `<rect x="${x}" y="${y(i) - 11}" width="30" height="22" rx="5" fill="#1e293b" stroke="#22d3ee" stroke-opacity=".6" /><path d="M${x + 7} ${y(i) + 5} q8 -12 16 0" stroke="#22d3ee" fill="none" /><line x1="${x + 15}" y1="${y(i) + 5}" x2="${x + 21}" y2="${y(i) - 6}" stroke="#22d3ee" />`;
  });
  svg += `<defs><linearGradient id="gc" x1="0" x2="1"><stop offset="0" stop-color="#059669" stop-opacity=".55"/><stop offset="1" stop-color="#2563eb" stop-opacity=".4"/></linearGradient></defs></svg>`;
  $("circuit").innerHTML = svg;
}

/* ---------- background qubit field ---------- */
function startField() {
  const c = $("field"), ctx = c.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h, pts;
  const resize = () => {
    w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio;
    const count = Math.min(70, Math.round((innerWidth * innerHeight) / 22000));
    pts = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, ph: Math.random() * 6.28 }));
  };
  const frame = (t) => {
    ctx.clearRect(0, 0, w, h);
    const link = 150 * devicePixelRatio;
    for (const a of pts) {
      a.x = (a.x + a.vx * devicePixelRatio + w) % w; a.y = (a.y + a.vy * devicePixelRatio + h) % h;
      for (const b of pts) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (a !== b && d < link) { ctx.strokeStyle = `rgba(16, 185, 129,${0.12 * (1 - d / link)})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      const glow = 0.5 + 0.5 * Math.sin(t / 900 + a.ph);
      ctx.fillStyle = `rgba(34,211,238,${0.25 + 0.5 * glow})`;
      ctx.beginPath(); ctx.arc(a.x, a.y, (1.2 + glow * 1.4) * devicePixelRatio, 0, 6.28); ctx.fill();
    }
    if (!still) requestAnimationFrame(frame);
  };
  resize(); addEventListener("resize", resize); requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
async function boot() {
  startField();
  bindControls();
  const cfg = await (await fetch("/api/presets")).json();
  state.presets = cfg.presets;
  state.maxAssets = cfg.max_assets;
  loadPreset(cfg.default);
  run();
  let t;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderChart, 150); });
}
boot();
