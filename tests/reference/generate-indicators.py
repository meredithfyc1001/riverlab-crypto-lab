"""Independent Decimal closed-form weighted-sum oracle; optional, not a CI dependency.
Classic Wilder RSI example prices: Wilder smoothing, first RSI ~= 70.4641350211.
Run from repo root. No market data claim: numerical algorithm fixture only.
"""
from decimal import Decimal as D, getcontext
from pathlib import Path
import json
getcontext().prec = 60
prices = list(map(D, '44.34 44.09 44.15 43.61 44.33 44.83 45.10 45.42 45.84 46.08 45.89 46.03 45.61 46.28 46.28 46.00 46.03 46.41 46.22 45.64 46.21 46.25 45.71 46.45 45.78 45.35 44.03 44.18 44.22 44.57 43.42 42.66 43.13'.split()))
n = 14
alpha = D(2) / (n+1)
beta = D(n-1) / n
up = [max(prices[i]-prices[i-1], D(0)) for i in range(1, len(prices))]
down = [max(prices[i-1]-prices[i], D(0)) for i in range(1, len(prices))]
# Each point recomputed independently from its full weighted sum (not recursive state).
ma, ema, rsi = [], [], []
for i in range(len(prices)):
    ma.append(float(sum(prices[i-n+1:i+1])/n) if i >= n-1 else None)
    if i >= n-1:
        k = i-(n-1)
        ema.append(float((sum(prices[:n])/n)*(1-alpha)**k + sum(alpha*(1-alpha)**(i-j)*prices[j] for j in range(n, i+1))))
    else: ema.append(None)
    if i >= n:
        k = i-n
        gain = (sum(up[:n])/n)*beta**k + sum(up[j-1]/n*beta**(i-j) for j in range(n+1, i+1))
        loss = (sum(down[:n])/n)*beta**k + sum(down[j-1]/n*beta**(i-j) for j in range(n+1, i+1))
        rsi.append(float(100/(1+loss/gain)))
    else: rsi.append(None)
Path('tests/fixtures/indicator-reference.json').write_text(json.dumps({'provenance':'Algorithm-only numerical fixture; independent Python Decimal 60-digit closed-form sums; not historical market data.', 'period':n, 'closes':list(map(float,prices)), 'ma':ma, 'ema':ema, 'rsi':rsi}, indent=2)+'\n')
