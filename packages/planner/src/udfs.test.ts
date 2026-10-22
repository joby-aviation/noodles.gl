import { describe, it, expect } from 'vitest';
import { FUNCTIONS } from './expr.js';
import { udfRegistrations, registerUdfs } from './udfs.js';
import type { FunctionDef } from './functions.js';

describe('JS functions as DuckDB UDFs', () => {
  const udfs = { spiral: { params: ['x', { name: 'label', type: 'text' as const }], body: 'return [x, label.length]', width: 2 } };

  it('is one DuckDB function per component, named by a hash of its body', () => {
    const regs = udfRegistrations(udfs);
    expect(regs.map((r) => r.component)).toEqual([0, 1]);
    expect(regs[0].sqlName).toMatch(/^udf_spiral_[0-9a-z]+_0$/);
    const changed = udfRegistrations({ spiral: { ...udfs.spiral, body: 'return [x, 0]' } });
    expect(changed[0].sqlName).not.toBe(regs[0].sqlName);
  });

  it('expands a call to its components, casting each argument as DuckDB takes it', () => {
    const into = new Map<string, FunctionDef>();
    registerUdfs(into, udfs);
    const [first] = udfRegistrations(udfs);
    const sql = FUNCTIONS[first.sqlName].sql as (args: string[]) => string;
    // `x` is auto, cast by analysis from its column's type; `label` is declared text
    expect(sql(['"x"', '"label"'])).toBe(`${first.sqlName}("x", CAST("label" AS VARCHAR))`);
    expect(FUNCTIONS[first.sqlName].wgsl).toBeNull();
    const expanded = into.get('spiral')?.expand?.([{ kind: 'col', name: 'x' }, { kind: 'col', name: 'label' }]);
    expect(expanded?.kind).toBe('vec');
  });
});
