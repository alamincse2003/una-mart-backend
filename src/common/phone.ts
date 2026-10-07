// Bangladeshi mobile numbers normalized to E.164 (+8801XXXXXXXXX) before
// storing or comparing (SYSTEM_DESIGN.md conventions, decision D7).
// Accepts 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX with spaces/dashes.
const BD_MOBILE = /^(?:\+?88)?(01[3-9]\d{8})$/;

export function normalizeBdPhone(input: string): string | null {
  const compact = input.replace(/[\s\-()]/g, '');
  const match = BD_MOBILE.exec(compact);
  return match ? `+88${match[1]}` : null;
}
