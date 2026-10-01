export function formatUsdc(atoms: string): string {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(atoms) || BigInt(atoms) >= 1n << 256n)
    throw new Error("Invalid USDC balance");
  const padded = atoms.padStart(7, "0");
  const whole = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
export function formatMon(wei: string): string {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(wei)) throw new Error("Invalid balance");
  const padded = wei.padStart(19, "0");
  const whole = padded.slice(0, -18);
  const fraction = padded.slice(-18).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatGwei(wei: string): string {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(wei) || BigInt(wei) >= 1n << 256n)
    throw new Error("Invalid gas price");
  const padded = wei.padStart(10, "0"),
    whole = padded.slice(0, -9),
    fraction = padded.slice(-9).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
