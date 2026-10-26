import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {keepBarAnchored} from '../scripts/panel-position.mjs';

test('removes negative top left by a previous layout update', () => {
  const properties = new Map([['top', '-137px']]);
  const bar = {style: {
    removeProperty(name) { properties.delete(name); },
    get top() { return properties.get('top') ?? ''; }
  }};
  keepBarAnchored(bar);
  assert.equal(bar.style.top, '');
});

test('does not fail while panel is absent during sheet redraw', () => {
  assert.doesNotThrow(() => keepBarAnchored(null));
});

test('actor sheet CSS supplies stable non-negative top anchor', () => {
  const css = readFileSync(new URL('../styles/module.css', import.meta.url), 'utf8');
  assert.match(css, /\.dnd5e2\.sheet\.actor \.lipatos-bd-parent\s*\{\s*position:\s*relative/);
  assert.match(css, /\.dnd5e2\.sheet\.actor \.lipatos-bd-bar\s*\{[^}]*top:\s*143px/);
});
