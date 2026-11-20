/**
 * Exact conversions between on-chain integers and the numeric(78,0) columns. Postgres returns numeric as string;
 * values are parsed with BigInt only (no Number/parseFloat anywhere on the money path).
 */
const UINT256_MAX = (1n << 256n) - 1n;

export function toDbAmount(v: bigint): string {
  if (v < 0n || v > UINT256_MAX) throw new RangeError(`amount out of uint256 range: ${v}`);
  return v.toString(10);
}

export function fromDbAmount(v: string | null | undefined): bigint {
  if (v === null || v === undefined) throw new TypeError("null amount");
  if (!/^\d+$/.test(v)) throw new TypeError(`not an exact integer amount: ${v}`);
  return BigInt(v);
}

export function normAddress(a: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new TypeError(`invalid address ${a}`);
  return a.toLowerCase() as `0x${string}`;
}

export function normBytes32(h: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new TypeError(`invalid bytes32 ${h}`);
  return h.toLowerCase() as `0x${string}`;
}
