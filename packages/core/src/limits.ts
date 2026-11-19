/**
 * Hard limits for reports read from outside the process (ADR 0005). A report that a fork's pull
 * request produced is untrusted, and the schema only checks shapes after the whole JSON text has
 * been parsed and walked. These limits bound the work first and give a clear error.
 *
 * Every value is far above what the collectors produce and at or above the bounds in the schema:
 * a valid report never reaches them. `maxStringLength` must stay at least as large as the longest
 * string bound in `schema.ts`.
 */
export const REPORT_LIMITS = {
  /** Size of a report file or JSON text. */
  maxBytes: 20_000_000,
  /** Nesting depth. A report nests 9 levels at most (an app's assets → packages → versions). */
  maxDepth: 16,
  /** Items in any array; the largest schema bound is 50 000 (entries, dependencies). */
  maxArrayLength: 50_000,
  /** Characters in any string or object key. */
  maxStringLength: 1024,
  /** Keys in any object; objects in a report have about 15 keys. */
  maxObjectKeys: 100,
  /** Values (objects, arrays, strings, numbers…) in the whole report. */
  maxNodes: 5_000_000,
} as const;

export type ReportLimits = { readonly [K in keyof typeof REPORT_LIMITS]: number };

interface Frame {
  readonly value: unknown;
  readonly depth: number;
}

/**
 * Walks parsed JSON without recursion (a deep document must not overflow the stack) and returns
 * a message for the first limit it exceeds, or `undefined`. Does not check `maxBytes`: that needs
 * the text or the file size.
 */
export function findLimitViolation(
  input: unknown,
  limits: ReportLimits = REPORT_LIMITS,
): string | undefined {
  const stack: Frame[] = [{ value: input, depth: 1 }];
  let nodes = 0;
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const { value, depth } = frame;
    nodes += 1;
    if (nodes > limits.maxNodes) return `has more than ${limits.maxNodes} values`;
    if (typeof value === 'string') {
      if (value.length > limits.maxStringLength)
        return `has a string longer than ${limits.maxStringLength} characters`;
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    if (depth > limits.maxDepth) return `is nested deeper than ${limits.maxDepth} levels`;
    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayLength)
        return `has an array with more than ${limits.maxArrayLength} items`;
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    const keys = Object.keys(value);
    if (keys.length > limits.maxObjectKeys)
      return `has an object with more than ${limits.maxObjectKeys} keys`;
    for (const key of keys) {
      if (key.length > limits.maxStringLength)
        return `has a key longer than ${limits.maxStringLength} characters`;
      stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  return undefined;
}
