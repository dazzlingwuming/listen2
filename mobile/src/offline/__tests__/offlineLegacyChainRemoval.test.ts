// @ts-nocheck -- Jest's Node-only filesystem assertion is intentionally outside RN typings.
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
test('legacy download slice is unreachable from store', () => {
  expect(existsSync(resolve(__dirname, '../../store/downloadSlice.ts'))).toBe(
    false,
  );
  expect(
    readFileSync(resolve(__dirname, '../../store/index.ts'), 'utf8'),
  ).not.toContain('downloadSlice');
});
