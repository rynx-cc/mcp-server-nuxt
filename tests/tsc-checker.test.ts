import { describe, expect, it } from 'vitest';
import { parseTscOutput } from '../src/utils/tsc-checker.js';

describe('parseTscOutput', () => {
  it('parses error and warning lines', () => {
    const output = [
      "src/foo.ts(3,5): error TS2304: Cannot find name 'x'.",
      "src/bar.ts(10,2): warning TS6133: 'y' is declared but its value is never read.",
      'Found 1 error in src/foo.ts:3',
    ].join('\n');

    const diagnostics = parseTscOutput(output);
    expect(diagnostics).toEqual([
      { file: 'src/foo.ts', line: 3, column: 5, severity: 'error', code: 2304, message: "Cannot find name 'x'." },
      { file: 'src/bar.ts', line: 10, column: 2, severity: 'warning', code: 6133, message: "'y' is declared but its value is never read." },
    ]);
  });

  it('returns an empty array for non-diagnostic output', () => {
    expect(parseTscOutput('')).toEqual([]);
    expect(parseTscOutput('no diagnostics here')).toEqual([]);
  });
});
