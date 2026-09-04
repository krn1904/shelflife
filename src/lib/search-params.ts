/** A repeated query key arrives as an array; take the first value and move on. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
