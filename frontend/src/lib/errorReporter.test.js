import test from 'node:test';import assert from 'node:assert/strict';
import{createErrorReporter}from'./errorReporter.js';
const loc={origin:'https://app.example',pathname:'/auth/confirm',search:'?code=secret',hash:'#access_token=x'};
test('reports are deduplicated, capped at five, and never include the query or fragment',()=>{
 const sent=[];const report=createErrorReporter({endpoint:'https://api.example/client-errors',send:(u,b)=>sent.push([u,JSON.parse(b)]),location:loc,userAgent:'UA'});
 assert.equal(report({message:'boom',source:'a.js',line:1,col:2}),true);
 assert.equal(report({message:'boom',source:'a.js',line:1,col:2}),false);
 for(let i=0;i<10;i++)report({message:'e'+i});
 assert.equal(sent.length,5);
 assert.equal(sent[0][0],'https://api.example/client-errors');
 assert.deepEqual(Object.keys(sent[0][1]).sort(),['col','line','message','source','stack','ua','url']);
 assert.equal(sent[0][1].url,'https://app.example/auth/confirm');
});
test('long fields are truncated before sending',()=>{
 let body;const report=createErrorReporter({endpoint:'x',send:(u,b)=>body=b,location:loc,userAgent:'UA'});
 report({message:'m'.repeat(5000),stack:'s'.repeat(9000)});
 const p=JSON.parse(body);assert.equal(p.message.length,500);assert.equal(p.stack.length,4000);assert.ok(body.length<8192);
});
