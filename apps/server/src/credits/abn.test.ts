import { describe, expect, it } from 'vitest';

import { formatAbn, isValidAbn, normaliseAbn } from './abn.js';

describe('the ABN check digits (the ATO algorithm)', () => {
  it("accepts the ATO's own example, 51 824 753 556", () => {
    expect(isValidAbn('51824753556')).toBe(true);
  });

  it('rejects the example with any one digit changed', () => {
    const abn = '51824753556';
    for (let i = 0; i < abn.length; i += 1) {
      for (const d of '0123456789') {
        if (d === abn[i]) continue;
        const changed = abn.slice(0, i) + d + abn.slice(i + 1);
        expect(isValidAbn(changed), changed).toBe(false);
      }
    }
  });

  it('rejects anything that is not eleven digits', () => {
    for (const bad of ['', '5182475355', '518247535566', '5182475355a', '51 824 753 556']) {
      expect(isValidAbn(bad), bad).toBe(false);
    }
  });

  it('normalises spaces away and formats in groups', () => {
    expect(normaliseAbn(' 51 824 753 556 ')).toBe('51824753556');
    expect(normaliseAbn('   ')).toBeNull();
    expect(normaliseAbn(null)).toBeNull();
    expect(formatAbn('51824753556')).toBe('51 824 753 556');
  });
});
