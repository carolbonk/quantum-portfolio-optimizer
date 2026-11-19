<p align="center">
  <img src="assets/banner.svg" alt="Quantum Portfolio Optimizer" width="100%" />
</p>

<p align="center">
  <a href="https://huggingface.co/spaces/CarolBonk/Quantum_Portfolio_Optimizer"><img src="https://img.shields.io/badge/Live%20demo-Hugging%20Face-10b981?style=for-the-badge&logo=huggingface&logoColor=white" alt="Live demo" /></a>
  <img src="https://img.shields.io/badge/Qiskit-2.6-22d3ee?style=for-the-badge&logo=qiskit&logoColor=white" alt="Qiskit" />
  <img src="https://img.shields.io/badge/FastAPI-backend-3b82f6?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
</p>

Pick the highest-return basket of stocks with QAOA while Black-Scholes call deltas keep options exposure under a cap.

- **QAOA on Qiskit Aer:** a Dicke start state and XY mixer keep exactly *k* stocks selected; the delta cap is a QUBO penalty with slack qubits.
- **Exact check:** every answer is compared with an exhaustive classical search.
- **Custom dashboard:** FastAPI backend, vanilla HTML/CSS/JS frontend and Plotly charts. Runs on the Hugging Face free CPU tier (up to 8 assets).

## Run locally

```bash
pip install -r requirements.txt "gradio[oauth,mcp]==6.32.0"  # gradio brings fastapi, uvicorn and pydantic
python app.py  # http://localhost:7860
```

Data is illustrative, not live market data, and nothing here is investment advice.

Built by **CarolBonk**.
