/**
 * Shared helpers for building MCP tool results and formatting output.
 */
import type { ToolResult } from '../types.js';

/** Build a tool result with a single text block. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Build a tool result that pretty-prints JSON. */
export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

/** Format an error for structured tool output (never throws). */
export function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return textResult(JSON.stringify({ error: message }, null, 2));
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

/** Truncate a long string to a maximum length, keeping a tail marker. */
export function truncate(text: string, maxLength = 50_000): string {
  if (text.length <= maxLength) return text;
  const head = text.slice(0, maxLength);
  const tail = text.slice(-Math.floor(maxLength / 4));
  return `${head}\n\n… [truncated ${text.length - head.length - tail.length} characters] …\n\n${tail}`;
}
