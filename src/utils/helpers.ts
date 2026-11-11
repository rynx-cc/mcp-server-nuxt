/**
 * Shared helpers for building MCP tool results and formatting output.
 */
import type { ToolResult } from '../types.js';

export type ToolErrorCode =
  | 'INTERNAL'
  | 'NOT_FOUND'
  | 'INVALID_PATH'
  | 'UNAUTHORIZED'
  | 'NOT_PREPARED'
  | 'INVALID_ARGUMENT';

export interface ToolErrorBody {
  error: {
    code: ToolErrorCode;
    message: string;
    hint?: string;
  };
}

/** Build a tool result with a single text block. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Build a tool result that pretty-prints JSON. */
export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

/** Structured tool error (never includes stack traces). */
export function structuredError(
  code: ToolErrorCode,
  message: string,
  hint?: string,
): ToolResult {
  const body: ToolErrorBody = { error: { code, message } };
  if (hint) body.error.hint = hint;
  return jsonResult(body);
}

/** Format an error for structured tool output (never throws, never leaks stacks). */
export function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return structuredError(
    'INTERNAL',
    message,
    'Retry the request. If it persists, check the project path and run nuxi prepare.',
  );
}

/** Wrap a handler so errors become structured results instead of crashes. */
export function safe<Args extends unknown[], R extends ToolResult>(
  fn: (...args: Args) => Promise<R> | R,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return errorResult(error) as R;
    }
  };
}

/** Apply limit/offset pagination to an array. */
export function paginate<T>(
  items: T[],
  limit?: number,
  offset?: number,
): { items: T[]; total: number; limit: number; offset: number; truncated: boolean } {
  const total = items.length;
  const start = Math.max(0, offset ?? 0);
  const max = limit === undefined ? total - start : Math.max(0, limit);
  const sliced = items.slice(start, start + max);
  return {
    items: sliced,
    total,
    limit: max,
    offset: start,
    truncated: start + sliced.length < total,
  };
}

/** Truncate a long string to a maximum length, keeping a tail marker. */
export function truncate(text: string, maxLength = 50_000): string {
  if (text.length <= maxLength) return text;
  const head = text.slice(0, maxLength);
  const tail = text.slice(-Math.floor(maxLength / 4));
  return `${head}\n\n… [truncated ${text.length - head.length - tail.length} characters] …\n\n${tail}`;
}
