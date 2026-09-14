import test from 'node:test';import assert from 'node:assert/strict';import {stockBalances,stockKey} from '../src/lib/inventory.ts';import type {Dose,InventoryReceipt} from '../src/lib/types.ts';
const r:InventoryReceipt={id:'receipt',productId:'ritalin',productName:'Ritalin IR',packageStrength:'10',strengthUnit:'mg',unit:'tablet',quantity:'10',receivedAt:'2026-09-01T00:00:00Z',timeZone:'UTC',note:'Synthetic'};
const dose=(id:string,quantity:string,status:Dose['status']='actual'):Dose=>({id,productId:'ritalin',productName:'Ritalin IR',formulation:'IR',strength:'10',packageStrength:'10',strengthUnit:'mg',quantity,unit:'tablet',amountMg:String(Number(quantity)*10),administeredAt:'2026-09-02T08:00:00Z',timeZone:'UTC',status,note:'Synthetic'});
test('half tablets deduct exactly 0.5 unit, not one tablet',()=>assert.equal(stockBalances([r],[dose('a','0.5')],Date.parse('2026-09-03'))[0].remaining,'9.5'));
test('planned doses do not consume stock; correction and undo recalculate once',()=>{assert.equal(stockBalances([r],[dose('a','0.5','planned')])[0].remaining,'10');assert.equal(stockBalances([r],[dose('a','1'),dose('a','1')])[0].remaining,'9');assert.equal(stockBalances([r],[])[0].remaining,'10');});
test('receipts deduplicate and additional receipts accumulate',()=>assert.equal(stockBalances([r,r,{...r,id:'r2',quantity:'20'}],[dose('a','0.5')])[0].remaining,'29.5'));
test('a different package strength is not deducted from a 10 mg pack',()=>assert.equal(stockBalances([r],[{...dose('a','1'),packageStrength:'5',strength:'5'}])[0].remaining,'10'));
test('earlier history is not deducted from a later starting stock',()=>assert.equal(stockBalances([r],[{...dose('a','1'),administeredAt:'2026-08-31T08:00:00Z'}])[0].remaining,'10'));
test('liquid volume remains exact and negative stock remains visible',()=>{const liquid={...r,productId:'liquid',packageStrength:'0.1',strengthUnit:'mg/mL',unit:'mL',quantity:'0.3'};const d={...dose('a','0.1'),productId:'liquid',packageStrength:'0.1',strengthUnit:'mg/mL',unit:'mL'};assert.equal(stockBalances([liquid],[d])[0].remaining,'0.2');assert.equal(stockBalances([r],[dose('a','10.5')])[0].remaining,'-0.5');});

const at = Date.parse('2026-09-03T00:00:00Z');

test('equivalent decimal strengths share stock while original snapshot text stays unchanged', () => {
  const receipt = { ...r, packageStrength: '10.000' };
  const taken = { ...dose('a', '0.5'), packageStrength: '10.0' };
  const before = JSON.stringify([receipt, taken]);
  const balances = stockBalances([receipt, { ...receipt, id: 'refill', packageStrength: '10', quantity: '2' }], [taken], at);
  assert.equal(balances.length, 1);
  assert.equal(balances[0].remaining, '11.5');
  assert.equal(balances[0].packageStrength, '10.000');
  assert.equal(JSON.stringify([receipt, taken]), before);
});

test('combination components normalize exactly but distinct ingredients, products and units remain separate', () => {
  const receipt = { ...r, productId: 'combo', packageStrength: '26.10/5.200' };
  const taken = { ...dose('a', '1'), productId: 'combo', strength: '26.1', packageStrength: '26.1/5.2' };
  assert.equal(stockBalances([receipt], [taken], at)[0].remaining, '9');
  for (const patch of [
    { packageStrength: '26.1/5.200000001' }, { packageStrength: '5.2/26.1' },
    { productId: 'other' }, { unit: 'mL' }, { strengthUnit: 'mg/mL' },
  ]) assert.equal(stockBalances([receipt], [{ ...taken, ...patch }], at)[0].remaining, '10');
  assert.notEqual(stockKey({ ...r, strengthUnit: 'mg|capsule', unit: 'tablet' }), stockKey({ ...r, strengthUnit: 'mg', unit: 'capsule|tablet' }));
});

test('latest dose revision determines quantity independently of input order', () => {
  const original = { ...dose('a', '1'), revision: 1 };
  const corrected = { ...dose('a', '0.5'), revision: 2 };
  for (const records of [[original, corrected], [corrected, original]]) {
    assert.equal(stockBalances([r], records, at)[0].remaining, '9.5');
  }
});

test('latest dose status and administration date are resolved before consumption filtering', () => {
  const original = { ...dose('a', '1'), revision: 1 };
  const corrections: Dose[] = [
    ...(['skipped', 'planned', 'simulated'] as const).map(status => ({ ...original, revision: 2, status })),
    { ...original, revision: 2, administeredAt: '2026-09-04T08:00:00Z' },
    { ...original, revision: 2, administeredAt: '2026-08-31T08:00:00Z' },
  ];
  for (const corrected of corrections) for (const records of [[original, corrected], [corrected, original]]) {
    assert.equal(stockBalances([r], records, at)[0].remaining, '10');
  }
});

test('latest receipt revision determines quantity and opening boundary before date filtering', () => {
  const original = { ...r, revision: 1 };
  const corrected = { ...r, revision: 2, quantity: '20', receivedAt: '2026-09-02T12:00:00Z' };
  for (const records of [[original, corrected], [corrected, original]]) {
    const balance = stockBalances(records, [dose('a', '1')], at)[0];
    assert.equal(balance.received, '20');
    assert.equal(balance.used, '0');
    assert.equal(balance.remaining, '20');
    assert.equal(balance.first, Date.parse(corrected.receivedAt));
  }
  const future = { ...corrected, receivedAt: '2026-09-04T00:00:00Z' };
  for (const records of [[original, future], [future, original]]) assert.deepEqual(stockBalances(records, [], at), []);
});

test('conflicting latest revisions are rejected while identical object snapshots ignore property order', () => {
  const taken = { ...dose('a', '1'), revision: 2 };
  const receipt = { ...r, revision: 2 };
  assert.throws(() => stockBalances([r], [taken, { ...taken, quantity: '0.5' }], at), /Conflicting copies/);
  assert.throws(() => stockBalances([receipt, { ...receipt, quantity: '20' }], [], at), /Conflicting copies/);
  const reordered = Object.fromEntries(Object.entries(taken).reverse()) as unknown as Dose;
  assert.equal(stockBalances([r], [taken, reordered], at)[0].remaining, '9');
  const corrected = { ...taken, revision: 3, quantity: '0.5' };
  assert.equal(stockBalances([r], [taken, { ...taken, quantity: '2' }, corrected], at)[0].remaining, '9.5');
});
