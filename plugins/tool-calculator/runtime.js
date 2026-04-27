/**
 * Calculator tool — evaluates math expressions safely via mathjs's restricted
 * evaluator. Handles arithmetic, trig, log/exp, units, and so on.
 */
import { evaluate } from 'mathjs';

export async function run(ctx, config, msg) {
  const expr =
    (typeof msg === 'string' && msg.trim()) || String(config.expression || '').trim();
  if (!expr) throw new Error("calculator tool needs an expression (input or config.expression)");

  ctx.emit({ kind: 'start', payload: { expression: expr } });

  let result;
  try {
    result = evaluate(expr);
  } catch (err) {
    throw new Error(`could not evaluate "${expr}": ${err instanceof Error ? err.message : err}`);
  }

  const text = formatResult(result);
  ctx.emit({ kind: 'output', payload: { expression: expr, result: text } });
  ctx.emit({ kind: 'end' });
  return text;
}

function formatResult(r) {
  if (r == null) return '';
  if (typeof r === 'number') return Number.isFinite(r) ? String(r) : 'NaN';
  if (typeof r === 'string') return r;
  // mathjs unit / matrix / complex objects all stringify reasonably.
  try {
    return r.toString();
  } catch {
    return String(r);
  }
}
