"""Illustrative scenarios (not live market data). Strikes vary so call deltas differ."""

COLUMNS = ["Ticker", "Price ($)", "Strike ($)", "Expected return (%)", "Volatility (%)"]

PRESETS = {
    "Quantum & AI Leaders": [
        ["IONQ", 38, 40, 28, 85],
        ["RGTI", 14, 15, 30, 95],
        ["NVDA", 180, 170, 22, 45],
        ["IBM", 260, 270, 11, 24],
        ["GOOGL", 245, 240, 15, 28],
        ["MSFT", 510, 520, 13, 22],
        ["HON", 210, 200, 9, 20],
        ["QBTS", 22, 25, 26, 90],
    ],
    "Tech Giants": [
        ["AAPL", 180, 170, 15, 25],
        ["GOOGL", 140, 145, 18, 28],
        ["MSFT", 370, 380, 12, 22],
        ["META", 480, 450, 17, 30],
    ],
    "Datacenter REITs": [
        ["EQIX", 180, 190, 12, 25],
        ["DLR", 100, 95, 15, 30],
        ["CCI", 150, 160, 10, 22],
        ["AMT", 200, 180, 18, 28],
    ],
    "Green Energy": [
        ["TSLA", 250, 230, 20, 40],
        ["ENPH", 180, 200, 16, 35],
        ["NEE", 60, 58, 11, 18],
        ["FSLR", 200, 210, 14, 32],
    ],
    "Dividend Kings": [
        ["JNJ", 160, 155, 8, 15],
        ["PG", 150, 155, 9, 16],
        ["KO", 58, 56, 7, 14],
        ["PEP", 170, 175, 10, 17],
    ],
}

DEFAULT_PRESET = "Quantum & AI Leaders"
