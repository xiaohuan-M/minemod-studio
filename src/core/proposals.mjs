import { AppError } from './errors.mjs';
export function validateProposals(value) {
  if (
    !value ||
    !Array.isArray(value.proposals) ||
    value.proposals.length < 2 ||
    value.proposals.length > 4
  )
    throw new AppError(422, 'INVALID_PROPOSALS', '需要 2–4 个可比较的方案。');
  const text = (v, max) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max)
      throw new AppError(422, 'INVALID_PROPOSALS', '方案文本缺失或过长。');
    return v.trim();
  };
  return value.proposals.map((p) => ({
    title: text(p.title, 80),
    summary: text(p.summary, 800),
    artDirection: text(p.artDirection, 800),
    instruction: text(p.instruction, 4000),
    gameplay: items(p.gameplay),
    acceptance: items(p.acceptance),
  }));
  function items(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 8)
      throw new AppError(422, 'INVALID_PROPOSALS', '玩法或验收条件需要 1–8 项。');
    return input.map((v) => text(v, 400));
  }
}
