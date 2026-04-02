import { all, create } from 'mathjs';
import type { MathNode } from 'mathjs';

// `all` is complete at runtime, but type defs allow undefined in some versions.
const math = create(all as NonNullable<typeof all>);

const ALLOWED_SYMBOLS = new Set(['x', 'pi', 'e']);
const ALLOWED_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'abs',
  'sqrt',
  'log',
  'ln',
  'exp',
]);

const ALLOWED_OPERATORS = new Set(['+', '-', '*', '/', '^']);

export type CompiledExpression = {
  evaluate(scope: { x: number }): unknown;
};

export type CompileResult =
  | { ok: true; compiled: CompiledExpression; expression: string }
  | { ok: false; error: string; expression: string };

export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'invalid' | 'non-finite' | 'too-large' };

export type EvaluateOptions = {
  maxAbsValue?: number;
};

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  // mathjs can return BigNumber/Complex/etc; we intentionally reject.
  return undefined;
}

function validateAst(node: MathNode, maxExponent: number): void {
  const anyNode = node as unknown as { type: string; name?: string; op?: string; fn?: { name?: string }; args?: MathNode[]; value?: unknown };

  switch (anyNode.type) {
    case 'ParenthesisNode': {
      validateAst((node as any).content as MathNode, maxExponent);
      return;
    }

    case 'ConstantNode': {
      // Allow numeric constants only.
      const constantValue = (node as any).value;
      const num = typeof constantValue === 'number' ? constantValue : Number(constantValue);
      if (!Number.isFinite(num)) throw new Error('Only finite numeric constants are allowed.');
      return;
    }

    case 'SymbolNode': {
      const name = (node as any).name as string;
      if (!ALLOWED_SYMBOLS.has(name)) {
        throw new Error(`Unknown symbol "${name}". Only "x", "pi", and "e" are allowed.`);
      }
      return;
    }

    case 'OperatorNode': {
      const op = (node as any).op as string;
      if (!ALLOWED_OPERATORS.has(op)) throw new Error(`Operator "${op}" is not allowed.`);

      const args = (node as any).args as MathNode[];
      for (const arg of args) validateAst(arg, maxExponent);

      // Guard against insane exponents that can blow up quickly.
      if (op === '^' && args.length === 2) {
        const right = args[1] as any;
        if (right?.type === 'ConstantNode') {
          const exp = Number(right.value);
          if (!Number.isFinite(exp) || Math.abs(exp) > maxExponent) {
            throw new Error(`Exponent is too large (|exp| must be ≤ ${maxExponent}).`);
          }
        }
      }
      return;
    }

    case 'FunctionNode': {
      const fnName = ((node as any).fn?.name as string | undefined) ?? '';
      if (!ALLOWED_FUNCTIONS.has(fnName)) {
        throw new Error(`Function "${fnName || 'unknown'}" is not allowed.`);
      }
      const args = (node as any).args as MathNode[];
      for (const arg of args) validateAst(arg, maxExponent);
      return;
    }

    default:
      // Disallow anything that could be used for assignment, property access, arrays, etc.
      throw new Error(`Expression contains unsupported syntax: ${anyNode.type}.`);
  }
}

export function compileExpression(expression: string, opts?: { maxExponent?: number }): CompileResult {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { ok: false, expression, error: 'Enter a function of x (e.g., sin(x), x^2, 2*x+3).' };
  }

  try {
    const node = math.parse(trimmed) as MathNode;
    validateAst(node, opts?.maxExponent ?? 12);

    // Compile after validation to avoid supporting extra node types.
    // Compile via the mathjs instance so evaluation uses the same function table.
    const compiled = math.compile(trimmed) as unknown as CompiledExpression;
    return { ok: true, expression, compiled };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid expression.';
    return { ok: false, expression, error: message };
  }
}

export function evaluateCompiledAt(
  compiled: CompiledExpression,
  x: number,
  options?: EvaluateOptions
): EvalResult {
  // Guard against garbage input.
  if (!Number.isFinite(x)) return { ok: false, reason: 'invalid' };

  let raw: unknown;
  try {
    raw = compiled.evaluate({ x });
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  const value = asNumber(raw);
  if (!isFiniteNumber(value)) return { ok: false, reason: 'non-finite' };

  const maxAbs = options?.maxAbsValue ?? 1e6;
  if (Math.abs(value) > maxAbs) return { ok: false, reason: 'too-large' };

  // Normalize -0 to 0 to avoid jitter.
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}
