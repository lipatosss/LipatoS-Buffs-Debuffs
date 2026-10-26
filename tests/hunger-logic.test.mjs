import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {advanceHunger, reduceHunger} from '../scripts/hunger-logic.mjs';

test('first long rest after eating shows hunger level zero', () => {
  const afterEating = null; // food clears current hunger
  assert.equal(advanceHunger(afterEating), 0);
});
test('successive rests without food increase hunger normally', () => {
  let hunger = null;
  for (const expected of [0,1,2,3,4,5,6,6]) {
    hunger = advanceHunger(hunger);
    assert.equal(hunger, expected);
  }
});
test('a meal resets hunger; next rest restarts at zero, not no hunger', () => {
  let hunger = advanceHunger(advanceHunger(null));
  assert.equal(hunger, 1);
  hunger = null; // eat: remove hunger
  hunger = advanceHunger(hunger);
  assert.equal(hunger, 0);
  assert.equal(advanceHunger(hunger), 1);
});
test('reducing hunger by GM works at all boundaries', () => {
  assert.equal(reduceHunger(null), null);
  assert.equal(reduceHunger(0), null);
  assert.equal(reduceHunger(2), 1);
});
test('rest handler advances hunger regardless of the fed flag', () => {
  const script = readFileSync(new URL('../scripts/hunger.mjs', import.meta.url), 'utf8');
  assert.match(script, /: advanceHunger\(previous\);/);
  assert.doesNotMatch(script, /advanceHunger\(previous,\s*fed\)/);
});
