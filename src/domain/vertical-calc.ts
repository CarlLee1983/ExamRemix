// 直式計算的數值：運算元與答案是十進位字串，用放大成整數的 BigInt 精確運算，不經過浮點數。
// 只有 schema 與直式計算元件讀這個檔，數字格式與結果的定義集中在此。

export const OPERATORS = ['+', '-', '×'] as const;
export type Operator = (typeof OPERATORS)[number];

/** 非負十進位數：數字，最多一個小數點，小數點前後都要有數字。 */
export const DECIMAL_FORMAT = /^\d+(\.\d+)?$/;

/** value / 10^scale */
interface Scaled {
  value: bigint;
  scale: number;
}

function parse(decimal: string): Scaled {
  const [int, frac = ''] = decimal.split('.');
  return { value: BigInt(int! + frac), scale: frac.length };
}

function rescale({ value, scale }: Scaled, to: number): bigint {
  return value * 10n ** BigInt(to - scale);
}

function format({ value, scale }: Scaled): string {
  const digits = value.toString().padStart(scale + 1, '0');
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale).replace(/0+$/, '');
  return frac === '' ? int : `${int}.${frac}`;
}

/** 依序計算 a op b op c…；減法結果為負時回傳 null。 */
export function calculate(operands: string[], operator: Operator): string | null {
  const [first, ...rest] = operands.map(parse);
  let acc = first!;
  for (const next of rest) {
    if (operator === '×') {
      acc = { value: acc.value * next.value, scale: acc.scale + next.scale };
    } else {
      const scale = Math.max(acc.scale, next.scale);
      const a = rescale(acc, scale);
      const b = rescale(next, scale);
      acc = { value: operator === '+' ? a + b : a - b, scale };
    }
  }
  return acc.value < 0n ? null : format(acc);
}

/** 以數值比較兩個十進位字串：12.50 等於 12.5。 */
export function sameNumber(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  return rescale(x, scale) === rescale(y, scale);
}

/** 整數部分與小數部分的位數，供元件排版。 */
export function digitCounts(decimal: string): { int: number; frac: number } {
  const [int, frac = ''] = decimal.split('.');
  return { int: int!.length, frac: frac.length };
}
