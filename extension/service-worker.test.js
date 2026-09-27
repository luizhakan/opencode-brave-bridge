import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('./service-worker.js',import.meta.url),'utf8');
function harness({tabs=[],grants={},windows=[{id:1,focused:true,type:'normal'}],groupError,updateError}={}) {
  const ev={},store={...grants},responses=[],calls={groups:[],updates:[],creates:[],removed:[],permissionRemovals:[]}; let nextGroup=20,nextTab=100;
  const event=n=>({addListener(fn){(ev[n]||=[]).push(fn);}}), port={onMessage:event('native'),onDisconnect:event('disconnect'),postMessage:m=>responses.push(m)};
  const chrome={runtime:{id:'extension-id',getURL:x=>'chrome-extension://extension-id/'+x,onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('connect'),onMessage:event('message'),connectNative:()=>port},windows:{async getAll(){return windows}},storage:{session:{async get(){return {...store}},async set(o){Object.assign(store,o)},async remove(k){delete store[k]},async clear(){for(const k of Object.keys(store))delete store[k]}}},permissions:{async contains(){return true},async remove(x){calls.permissionRemovals.push(x)}},tabGroups:{onRemoved:event('removed'),async get(id){const tab=tabs.find(t=>t.groupId===id);if(!tab&&!Object.values(store).some(g=>g.groupId===id))throw Error('missing group');return{id,title:'old',windowId:tab?.windowId??1}},async update(id,x){calls.updates.push({id,...x});if(updateError)throw updateError}},tabs:{async query(){return tabs},async get(id){const t=tabs.find(x=>x.id===id);if(!t)throw Error('missing tab');return t},async group(o){calls.groups.push(o);if(groupError)throw groupError;if(o.groupId!=null){for(const id of o.tabIds){const t=tabs.find(x=>x.id===id);if(t)t.groupId=o.groupId}return o.groupId} const id=nextGroup++; for(const tid of o.tabIds){const t=tabs.find(x=>x.id===tid);if(t)t.groupId=id}return id},async create(o){calls.creates.push(o);const tab={id:nextTab++,...o};tabs.push(tab);return tab},async remove(id){calls.removed.push(id);const i=tabs.findIndex(t=>t.id===id);if(i>=0)tabs.splice(i,1)},async update(){}},scripting:{async executeScript(){return[{result:{}}]}}};
  vm.runInNewContext(source,{chrome,URL,Map,Object,Array,Number,Boolean,String,Error,Date,JSON,console,crypto:{randomUUID:()=>`nonce-${Math.random()}`}});
  const request=async(project,session,op,params={})=>{const req={v:2,id:String(responses.length),ctx:{project,session},op,params};await ev.native[0](req);return responses.at(-1)};
  const message=async m=>{let result;ev.message[0](m,{id:'extension-id',url:'chrome-extension://extension-id/popup.html'},x=>{result=x});for(let i=0;i<30&&!result;i++)await new Promise(r=>setImmediate(r));return result;};
  return{request,message,calls,store,events:ev};
}
const pending=async(h,p='P',s='ses_A',origins=['https://ok.test'])=>h.request(p,s,'group.status',{origins});

test('two sessions are isolated even in the same project',async()=>{
 const h=harness({tabs:[{id:1,groupId:7,windowId:1,url:'https://ok.test/a'}],grants:{'["P","ses_A"]':{project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']},'["P","ses_B"]':{project:'P',session:'ses_B',groupId:8,windowId:1,origins:['https://ok.test']}}});
 const own=await h.request('P','ses_A','tabs.list'),other=await h.request('P','ses_B','tabs.list');
 assert.deepEqual(JSON.parse(JSON.stringify(own.result.tabs)).map(x=>x.handle),[1]); assert.deepEqual(JSON.parse(JSON.stringify(other.result.tabs)),[]);
});
test('approves proposal without moving tabs and retains inactive seed group',async()=>{
 const h=harness({tabs:[]}), status=await pending(h), nonce=status.result.nonce;
 const result=await h.message({type:'grant',key:'["P","ses_A"]',origins:['https://ok.test'],nonce});
 assert.equal(result.ok,true);assert.equal(h.calls.creates.length,1);assert.equal(h.calls.creates[0].active,false);assert.equal(h.calls.groups.length,1);assert.equal(h.calls.groups[0].tabIds[0],100);assert.deepEqual(h.calls.removed,[]);
});
test('tab.open uses the current group window and stays inactive',async()=>{
 const grant={project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']};
 const h=harness({tabs:[{id:5,groupId:7,windowId:42,url:'https://ok.test/'}],grants:{'["P","ses_A"]':grant}});
 const result=await h.request('P','ses_A','tab.open',{url:'https://ok.test/new'});
 assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(h.calls.creates)),[{url:'https://ok.test/new',windowId:42,active:false}]);
});
test('cleans up seed tab when grouping or group update fails',async()=>{
 for(const options of [{groupError:Error('group failed')},{updateError:Error('update failed')}]){
  const h=harness(options),status=await pending(h);
  await h.message({type:'grant',key:'["P","ses_A"]',origins:['https://ok.test'],nonce:status.result.nonce});
  assert.deepEqual(h.calls.removed,[100]);assert.equal(h.store['["P","ses_A"]'],undefined);
 }
});
test('removing a group clears grants and releases permissions',async()=>{
 const grant={project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']};
 const h=harness({grants:{'["P","ses_A"]':grant}});
 await h.events.removed[0]({id:7});
 assert.equal(h.store['["P","ses_A"]'],undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.permissionRemovals)),[{origins:['https://ok.test/*']}]);
});
test('concurrent approvals create only one seed tab',async()=>{
 const h=harness(),status=await pending(h),message={type:'grant',key:'["P","ses_A"]',origins:['https://ok.test'],nonce:status.result.nonce};
 await Promise.all([h.message(message),h.message(message)]);
 assert.equal(h.calls.creates.filter(x=>x.url.endsWith('/seed.html')).length,1);
});
test('requires matching immutable pending nonce and exact origins; malformed origins rejected',async()=>{
 const h=harness(), first=await pending(h), oldNonce=first.result.nonce;
 const changed=await h.request('P','ses_A','group.status',{origins:['https://other.test']});
 assert.notEqual(changed.result.nonce,oldNonce);
 assert.match((await h.message({type:'grant',key:'["P","ses_A"]',origins:['https://ok.test'],nonce:oldNonce})).error,/proposal changed/);
 assert.match((await h.request('P','ses_A','group.status',{origins:['http://evil.test']})).error.message,/Invalid origin/);
 assert.equal((await h.message({type:'grant',key:'["P","ses_A"]',origins:['https://other.test'],nonce:changed.result.nonce})).ok,true);
});
test('does not use existing grant as fallback when proposal is absent',async()=>{
 const h=harness({grants:{'["P","ses_A"]':{project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']}}});
 assert.match((await h.message({type:'grant',key:'["P","ses_A"]',origins:['https://ok.test']})).error,/No origins proposed/);
});
test('rejects untrusted or non-popup runtime messages',async()=>{
 const h=harness();await pending(h);
 let response;h.events.message[0]({type:'grant',key:'["P","ses_A"]',origins:['https://ok.test']},{id:'evil',url:'https://evil.test'},x=>response=x);
 assert.equal(response,undefined);assert.equal(h.calls.creates.length,0);
});
