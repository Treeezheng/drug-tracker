import test from 'node:test';
import assert from 'node:assert/strict';
import { accountPasswordError, assessAccountPassword, assessVaultPassphrase, vaultPasswordError, masterPasswordError } from '../src/lib/password-policy.mjs';

test('shared new-password policy rejects common patterns even at sufficient length and accepts independent strong phrases',async()=>{
  for(const value of ['password123456789','Password123456789!','qwertyuiop123456789','aaaaaaaaaaaaaaaaaaaa']){
    assert.ok(await accountPasswordError(value));assert.ok(await vaultPasswordError(value));
  }
  const phrase='SYNTHETIC! glacier orbit fern 8294';
  assert.equal(await accountPasswordError(phrase),null);assert.equal(await vaultPasswordError(phrase),null);
  assert.equal((await assessVaultPassphrase(phrase)).score,4);
});

test('one-password policy requires score four and 15–256 Unicode codepoints without excluding long valid astral input',async()=>{
  for(const value of ['Password123456789!','!A4zxR@9hF_1g','\ud800 synthetic malformed 2891'])assert.ok(await masterPasswordError(value));
  assert.equal(await masterPasswordError('Synthetic independent! lunar maple 4291','synthetic-owner'),null);
  const unicode=Array.from({length:256},(_,index)=>String.fromCodePoint(0x1f300+index)).join('');
  assert.equal(unicode.length,512);assert.equal(await masterPasswordError(unicode),null);
  assert.ok(await masterPasswordError(`${unicode}x`));
  assert.ok(await masterPasswordError('predictableusername','predictableusername'));
});

test('new password length and malformed Unicode are bounded before estimation; username is considered a predictable input',async()=>{
  for(const value of ['abc','a'.repeat(257),'\ud800abcd-123456789'])assert.ok(await accountPasswordError(value));
  for(const value of ['abc','a'.repeat(1025),'\ud800abcd-123456789'])assert.ok(await vaultPasswordError(value));
  const username='ZXsyntheticowner9237';
  assert.equal((await assessAccountPassword(username,username)).acceptable,false);
  assert.equal((await assessAccountPassword('🌳'.repeat(8))).acceptable,false); // UTF-16 length is not the character minimum.
});
