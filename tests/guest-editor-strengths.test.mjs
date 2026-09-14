import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { newDose, updateDose } from '../src/components/DoseEditor.tsx';
import { freshGuestWorkspace } from '../src/lib/guest-workspace.ts';

// Render the real guest parent and its real DoseEditor. Isolate CSS, the unrelated
// legal footer, and browser storage; no account, browser, or network is used.
const guestFile = new URL('../src/components/GuestSimulator.tsx', import.meta.url);
const requireFromGuest = createRequire(guestFile);
const source = readFileSync(guestFile, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/drug/'");
const exported = {};
runInNewContext(ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, {
  exports: exported,
  window: { localStorage: { getItem: () => null } },
  require: name => name.endsWith('.css') ? {}
    : name === './MedicalDisclaimer' ? { default: () => null } : requireFromGuest(name),
});

function renderedStrengths(workspace) {
  const html = renderToStaticMarkup(createElement(exported.default, {
    initialWorkspace: workspace, initialConsent: true, onSignIn() {}, onRegister() {},
  }));
  const select = html.match(/<select aria-label="Dose 1 strength"[\s\S]*?<\/select>/)?.[0];
  assert.ok(select, 'The guest parent must render its dose editor.');
  return [...select.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
}

test('clearing guest favorites keeps only the existing dose strength in the rendered editor', () => {
  const workspace = freshGuestWorkspace('UTC');
  workspace.drafts = [{ ...updateDose(newDose('methylphenidate-ir', '10'), {
    date: workspace.date, time: '08:00', quantity: '1.5',
  }, 'UTC'), id: 'synthetic-guest-dose', status: 'simulated' }];
  workspace.favorites = [{ id: 'synthetic-favorite', productId: 'methylphenidate-ir',
    strength: '20', packageStrength: '20', quantity: '1' }];
  const original = structuredClone(workspace);
  assert.deepEqual(renderedStrengths(workspace), ['20', '10']);
  assert.deepEqual(renderedStrengths({ ...workspace, favorites: [] }), ['10']);
  assert.deepEqual(workspace, original, 'Rendering must preserve the dose and its exact quantity.');
});
