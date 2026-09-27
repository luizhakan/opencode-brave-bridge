import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('./service-worker.js',import.meta.url),'utf8');
function harness({tabs=[],grants={}}={}) {
  const ev={},store={...grants},responses=[],calls={groups:[],updates:[],creates:[],removed:[]}; let nextGroup=20;
  const event=n=>({addListener(fn){(ev[n]||=[]).push(fn);}}), port={onMessage:event('native'),onDisconnect:event('disconnect'),postMessage:m=>responses.push(m)};
  const chrome={runtime:{onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('connect'),onMessage:event('message'),connectNative:()=>port},storage:{session:{async get(){return {...store}},async set(o){Object.assign(store,o)},async remove(k){delete store[k]},async clear(){for(const k of Object.keys(store))delete store[k]}}},permissions:{async contains(){return true},async remove(x){calls.removed.push(x)}},tabGroups:{onRemoved:event('removed'),async get(id){return{id,title:'old',windowId:1}},async update(id,x){calls.updates.push({id,...x})}},tabs:{async query(){return tabs},async get(id){const t=tabs.find(x=>x.id===id);if(!t)throw Error('missing tab');return t},async group(o){calls.groups.push(o);if(o.groupId!=null){for(const id of o.tabIds){const t=tabs.find(x=>x.id===id);if(t)t.groupId=o.groupId}return o.groupId} const id=nextGroup++; for(const tid of o.tabIds){const t=tabs.find(x=>x.id===tid);if(t)t.groupId=id}return id},async create(o){calls.creates.push(o);return{id:99,...o}},async update(){}},scripting:{async executeScript(){return[{result:{}}]}}};
  vm.runInNewContext(source,{chrome,URL,Map,Object,Array,Number,Boolean,String,Error,Date,JSON,console});
  const request=async(project,session,op,params={})=>{const req={v:2,id:String(responses.length),ctx:{project,session},op,params};await ev.native[0](req);return responses.at(-1)};
  const message=async m=>await ev.message[0](m,null,x=>responses.push(x));
  return{request,message,calls,store,events:ev};
}
const pending=async(h,p='P',s='ses_A')=>h.request(p,s,'group.status');

test('two sessions are isolated even in the same project',async()=>{
 const h=harness({tabs:[{id:1,groupId:7,windowId:1,url:'https://ok.test/a'}],grants:{'["P","ses_A"]':{project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']},'["P","ses_B"]':{project:'P',session:'ses_B',groupId:8,windowId:1,origins:['https://ok.test']}}});
 const own=await h.request('P','ses_A','tabs.list'),other=await h.request('P','ses_B','tabs.list');
 assert.deepEqual(JSON.parse(JSON.stringify(own.result.tabs)).map(x=>x.handle),[1]); assert.deepEqual(JSON.parse(JSON.stringify(other.result.tabs)),[]);
});
test('selected multiple tabs are added to selected session group preserving prior tabs/origins',async()=>{
 const tabs=[{id:1,groupId:7,windowId:1,url:'https://one.test/a'},{id:2,groupId:-1,windowId:1,url:'https://two.test/b'}];
 const h=harness({tabs,grants:{'["P","ses_A"]':{project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://one.test']}}});await pending(h);
 let done; await h.message({type:'grant',key:'["P","ses_A"]',tabIds:[1,2],origins:['https://one.test','https://two.test']});
 // grant reply is asynchronously queued; wait for storage mutation.
 for(let i=0;i<20&&!h.store['["P","ses_A"]']?.origins.includes('https://two.test');i++)await new Promise(r=>setImmediate(r));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.groups)),[{tabIds:[1,2],groupId:7}]);assert.deepEqual(Array.from(h.store['["P","ses_A"]'].origins),['https://one.test','https://two.test']);assert.equal(tabs[0].groupId,7);assert.equal(tabs[1].groupId,7);
});
test('cannot take tab already owned by another session group',async()=>{
 const h=harness({tabs:[{id:3,groupId:8,windowId:1,url:'https://ok.test/'}],grants:{'["P","ses_B"]':{project:'P',session:'ses_B',groupId:8,windowId:1,origins:['https://ok.test']}}});await pending(h,'P','ses_A');
 await h.message({type:'grant',key:'["P","ses_A"]',tabIds:[3],origins:['https://ok.test']});
 await new Promise(r=>setImmediate(r)); assert.deepEqual(h.calls.groups,[]); assert.equal(h.store['["P","ses_B"]'].groupId,8);
});
test('cannot take tabs from an unrelated browser group',async()=>{
 const h=harness({tabs:[{id:4,groupId:44,windowId:1,url:'https://ok.test/'}]});await pending(h);
 await h.message({type:'grant',key:'["P","ses_A"]',tabIds:[4],origins:['https://ok.test']});
 await new Promise(r=>setImmediate(r));assert.deepEqual(h.calls.groups,[]);
});
test('grant queue recovers after failure and serializes revoke after grant',async()=>{
 const h=harness({tabs:[{id:1,groupId:44,windowId:1,url:'https://ok.test/a'},{id:2,groupId:-1,windowId:1,url:'https://ok.test/b'}]});await pending(h);
 await h.message({type:'grant',key:'["P","ses_A"]',tabIds:[1],origins:['https://ok.test']});
 await h.message({type:'grant',key:'["P","ses_A"]',tabIds:[2],origins:['https://ok.test']});
 await h.message({type:'revoke',key:'["P","ses_A"]'});
 for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));
 assert.equal(h.calls.groups.filter(x=>x.groupId==null).length,1);assert.equal(h.store['["P","ses_A"]'],undefined);
});
test('concurrent grants for one pending session serialize and cannot create conflicting groups',async()=>{
 const h=harness({tabs:[{id:1,groupId:-1,windowId:1,url:'https://ok.test/a'},{id:2,groupId:-1,windowId:1,url:'https://ok.test/b'}]});await pending(h);
 await Promise.all([h.message({type:'grant',key:'["P","ses_A"]',tabIds:[1],origins:['https://ok.test']}),h.message({type:'grant',key:'["P","ses_A"]',tabIds:[2],origins:['https://ok.test']})]);
 await new Promise(r=>setImmediate(r)); assert.equal(h.calls.groups.filter(x=>x.groupId==null).length,1);
});
