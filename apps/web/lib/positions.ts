import { WAD, hf } from "./format";

export interface HfSeries {
  points: string;
  liquidationY: number | null;
  minLabel: string;
  maxLabel: string;
  count: number;
}

/**
 * Maps an oldest→newest list of HF values (WAD) onto a 600×160 SVG polyline. Returns null with fewer than two
 * points (a single observation is not a trend). Values above HF 10 are clamped so one idle reading cannot flatten
 * the chart; the labels still show the true min/max.
 */
export function hfSeries(values: bigint[], width = 600, height = 160, pad = 8): HfSeries | null {
  if (values.length < 2) return null;
  const cap = WAD * 10n;
  const v = values.map((x) => (x > cap ? cap : x));
  let min = v[0]!;
  let max = v[0]!;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const span = max - min === 0n ? 1n : max - min;
  const y = (x: bigint) => pad + Number(((max - x) * BigInt((height - 2 * pad) * 1000)) / span) / 1000;
  const step = width / (v.length - 1);
  const points = v.map((x, i) => `${(i * step).toFixed(1)},${y(x).toFixed(1)}`).join(" ");
  const trueMin = values.reduce((a, b) => (b < a ? b : a));
  const trueMax = values.reduce((a, b) => (b > a ? b : a));
  return {
    points,
    liquidationY: WAD >= min && WAD <= max ? y(WAD) : null,
    minLabel: hf(trueMin.toString()),
    maxLabel: hf(trueMax.toString()),
    count: values.length,
  };
}
