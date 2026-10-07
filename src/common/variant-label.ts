/** {"size":"M","color":"Navy"} → "M / Navy"; {} → "". */
export function variantLabel(options: unknown): string {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return '';
  return Object.values(options as Record<string, unknown>)
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' / ');
}
