import test from 'node:test';
import assert from 'node:assert/strict';
import {doseRowId,focusDoseRow} from '../src/lib/dose-row-focus';

function fixture(reduced=false){
 const calls:unknown[]=[];
 const control={disabled:false,focus:(options:unknown)=>calls.push(['focus',options]),scrollIntoView:(options:unknown)=>calls.push(['scroll',options])};
 const row={isConnected:true,querySelector:(selector:string)=>{assert.equal(selector,'.medication-field select');return control;}};
 let open=false;
 const document={getElementById:(id:string)=>id===doseRowId('new-row')?row:null,querySelector:(selector:string)=>{assert.equal(selector,'dialog[open]');return open?{}:null;},defaultView:{matchMedia:(query:string)=>{assert.equal(query,'(prefers-reduced-motion: reduce)');return{matches:reduced};}}};
 return {document:document as unknown as Document,control,row,calls,modal:(value:boolean)=>{open=value;}};
}

test('explicit new-row focus uses its stable identity and a single controlled scroll, not list index',()=>{
 const f=fixture();assert.equal(focusDoseRow(f.document,'an-old-row'),false);assert.equal(f.calls.length,0);
 assert.equal(focusDoseRow(f.document,'new-row'),true);
 assert.deepEqual(f.calls,[['focus',{preventScroll:true}],['scroll',{block:'center',inline:'nearest',behavior:'smooth'}]]);
});

test('a first-selection modal prevents new-row focus until it closes; reduced motion remains respected',()=>{
 const f=fixture(true);f.modal(true);assert.equal(focusDoseRow(f.document,'new-row'),false);assert.equal(f.calls.length,0);
 f.modal(false);assert.equal(focusDoseRow(f.document,'new-row'),true);
 assert.deepEqual(f.calls[1],['scroll',{block:'center',inline:'nearest',behavior:'instant'}]);
});

test('removed or unavailable draft rows do not redirect focus or page position',()=>{
 const f=fixture();f.control.disabled=true;assert.equal(focusDoseRow(f.document,'new-row'),false);
 f.control.disabled=false;f.row.isConnected=false;assert.equal(focusDoseRow(f.document,'new-row'),false);assert.deepEqual(f.calls,[]);
});
