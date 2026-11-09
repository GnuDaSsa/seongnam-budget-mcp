import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedTableContext} from '../worker/verified-table-context.js';
test('verified spreadsheet header is restricted to exact source and block',()=>{
 const doc={id:'b6b50280e845dfee8282',sha256:'f14bbe75a5bcbc6bb7907c3566186cb6e2712aaeb54caec12f1efe33547b48fb'};
 const hash='df116f7e6598f030d00d94e82e786d0f9c359209f8eb6de3008799e6c1326984';
 const c=verifiedTableContext(doc,775,hash);assert.equal(c.unit_header.cell,'I2');assert.equal(c.column_header.cell,'J3');assert.equal(c.amount_cell,'J5125');assert.equal(c.amount,4000);
 assert.equal(verifiedTableContext(doc,774,hash),null);assert.equal(verifiedTableContext({...doc,id:'another'},775,hash),null);assert.equal(verifiedTableContext({...doc,sha256:'different'},775,hash),null);assert.equal(verifiedTableContext(doc,775,'different'),null);
});

test('reviewed mappings never cross sheet, block or conflicting records',async()=>{
 const {lookupVerifiedTableContext:lookup}=await import('../worker/verified-table-context.js');
 const doc={id:'doc',sha256:'source-hash'};
 const rows=[{document_id:'doc',document_sha256:'source-hash',page:1,text_sha256:'one',context:{sheet:'A',unit:'천원'}},{document_id:'doc',document_sha256:'source-hash',page:2,text_sha256:'two',context:{sheet:'B',unit:'원'}}];
 assert.equal(lookup(rows,doc,1,'one').unit,'천원');assert.equal(lookup(rows,doc,2,'two').unit,'원');
 assert.equal(lookup(rows,doc,2,'one'),null);assert.equal(lookup(rows,doc,3,'two'),null);
 assert.equal(lookup([...rows,rows[0]],doc,1,'one'),null);
});
