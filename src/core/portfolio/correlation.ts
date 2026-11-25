import type { CloseSnapshot } from '../backtests';
import { readUnits } from '../math';
import { fraction } from '../statistics';
import type { Metric } from '../statistics';

// Input prices are integers below 10^48 in fixed18 units. Two unequal
// rational returns therefore differ by more than 10^-96.
const RETURN_SCALE = 10n ** 96n;
const COEFFICIENT_SCALE = 10n ** 12n;

function moments(closes: CloseSnapshot[]) {
  let previous = readUnits(closes[0].account.markPrice);
  let sum = 0n;
  let sumSquares = 0n;
  const returns: bigint[] = [];
  for (let i = 1; i < closes.length; i++) {
    const current = readUnits(closes[i].account.markPrice);
    const value = ((current - previous) * RETURN_SCALE) / previous;
    returns.push(value);
    sum += value;
    sumSquares += value * value;
    previous = current;
  }
  return {
    returns,
    sum,
    variance: BigInt(returns.length) * sumSquares - sum * sum,
  };
}

function integerSqrt(value: bigint) {
  if (value < 2n) return value;
  let root = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (root + value / root) / 2n;
    if (next >= root) return root;
    root = next;
  }
}

/** Rows and columns follow the prepared asset order. The caller has verified
 * every close timestamp. Only adjacent market closes are return observations. */
export function marketCorrelations(closes: CloseSnapshot[][]): Metric[][] {
  const data = closes.map(moments);
  const sampleCount = data[0].returns.length;
  const matrix: Metric[][] = data.map(() => []);
  for (let i = 0; i < data.length; i++) {
    for (let j = i; j < data.length; j++) {
      const left = data[i],
        right = data[j];
      let metric: Metric;
      if (sampleCount < 2) {
        metric = {
          value: null,
          reason: '至少需要两项对齐的收盘收益（三根K线）',
        };
      } else if (left.variance === 0n || right.variance === 0n) {
        metric = { value: null, reason: '对齐收益序列存在零方差' };
      } else {
        let products = 0n;
        for (let k = 0; k < sampleCount; k++)
          products += left.returns[k] * right.returns[k];
        const covariance =
          BigInt(sampleCount) * products - left.sum * right.sum;
        const scaled = covariance * COEFFICIENT_SCALE;
        // floor(sqrt(floor(scaled² / (Vx Vy)))) is the exact 12-place
        // magnitude for the normalized return series, including |r| == 1.
        const magnitude = integerSqrt(
          (scaled * scaled) / (left.variance * right.variance),
        );
        metric = {
          value: fraction(
            covariance < 0n ? -magnitude : magnitude,
            COEFFICIENT_SCALE,
          ),
          reason: null,
        };
      }
      matrix[i][j] = metric;
      matrix[j][i] = metric;
    }
  }
  return matrix;
}
