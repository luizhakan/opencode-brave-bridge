import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('./service-worker.js',import.meta.url),'utf8');
function harness({tabs=[],grants={},local:initialLocal={},windows=[{id:1,focused:true,type:'normal'}],groupError,groupGetError,groupTitle='old',permission=true,debuggerPermission=true,screenshotData='jpeg-data',updateError,element:elementOptions={tag:'BUTTON',name:'Continue'},fileInput:uploadOptions={},uploadMismatch=false}={}) {
  const ev={},store={...grants},local={...initialLocal},responses=[],calls={groups:[],updates:[],creates:[],removed:[],permissionRemovals:[],debugger:[]}; let nextGroup=20,nextTab=100;
  const event=n=>({addListener(fn){(ev[n]||=[]).push(fn);}}), port={onMessage:event('native'),onDisconnect:event('disconnect'),postMessage:m=>responses.push(m)};
  const el={tagName:elementOptions.tag||'BUTTON',innerText:elementOptions.name||'',disabled:false,isConnected:true,form:null,click(){this.clicked=(this.clicked||0)+1},dispatchEvent(){},getAttribute(k){return ({role:'', 'aria-label':'','placeholder':'',type:elementOptions.type||'',href:elementOptions.href||'',formaction:elementOptions.formaction||'',target:elementOptions.target||'',ping:elementOptions.ping||''})[k]??null},matches(s){return elementOptions.methods?.matches?.(s)??false},closest(){return null},getClientRects(){return[{}]},hasAttribute(k){return !!elementOptions[k]},...elementOptions.methods};
  const fileEl={tagName:'INPUT',multiple:false,accept:'',disabled:false,files:[],form:{action:uploadOptions.action||'https://ok.test/upload',target:uploadOptions.target||''},...uploadOptions};
  const document={title:'Test',body:{innerText:''},querySelectorAll(s){return s==='input[type="file"]'?[fileEl]:[el]}};
  function MockInput(){} Object.defineProperty(MockInput.prototype,'value',{set(){fileEl.files=[]}});
  const world=vm.createContext({location:{origin:'https://ok.test',href:'https://ok.test/page'},document,HTMLInputElement:MockInput,getComputedStyle:()=>({visibility:'visible',display:'block'}),URL,Event:class{constructor(type){this.type=type}}});
  const chrome={runtime:{id:'extension-id',getURL:x=>'chrome-extension://extension-id/'+x,onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('connect'),onMessage:event('message'),connectNative:()=>port},windows:{async getAll(){return windows}},storage:{session:{async get(){return {...store}},async set(o){Object.assign(store,o)},async remove(k){delete store[k]},async clear(){for(const k of Object.keys(store))delete store[k]}},local:{async get(){return {...local}},async set(o){Object.assign(local,o)},async remove(k){for(const x of Array.isArray(k)?k:[k])delete local[x]}}},permissions:{async contains(x){return x.permissions?.includes('debugger')?debuggerPermission:permission},async remove(x){calls.permissionRemovals.push(x)}},debugger:{async attach(...x){calls.debugger.push(['attach',...x])},async sendCommand(...x){calls.debugger.push(['sendCommand',...x]);const method=x[1];if(method==='DOM.getDocument')return{root:{nodeId:10}};if(method==='DOM.querySelectorAll')return{nodeIds:[11]};if(method==='DOM.describeNode')return{node:{nodeName:'INPUT',attributes:['type','file']}};if(method==='DOM.setFileInputFiles'){fileEl.files=uploadMismatch?[]:[{name:'payload.txt',size:12}];return{}}return{data:screenshotData}},async detach(...x){calls.debugger.push(['detach',...x])}},tabGroups:{onRemoved:event('removed'),async get(id){if(groupGetError)throw groupGetError;const tab=tabs.find(t=>t.groupId===id),exists=tab||Object.values(store).some(g=>g.groupId===id)||Object.values(local).some(g=>g?.groupId===id);if(!exists)throw Error('missing group');return{id,title:groupTitle,windowId:tab?.windowId??1}},async update(id,x){calls.updates.push({id,...x});if(updateError)throw updateError;groupTitle=x.title}},tabs:{async query(){return tabs},async get(id){const t=tabs.find(x=>x.id===id);if(!t)throw Error('missing tab');return t},async group(o){calls.groups.push(o);if(groupError)throw groupError;if(o.groupId!=null){for(const id of o.tabIds){const t=tabs.find(x=>x.id===id);if(t)t.groupId=o.groupId}return o.groupId} const id=nextGroup++; for(const tid of o.tabIds){const t=tabs.find(x=>x.id===tid);if(t)t.groupId=id}return id},async create(o){calls.creates.push(o);const tab={id:nextTab++,...o};tabs.push(tab);return tab},async remove(id){calls.removed.push(id);const i=tabs.findIndex(t=>t.id===id);if(i>=0)tabs.splice(i,1)},async update(){}},scripting:{async executeScript(info){calls.scripts??=[];calls.scripts.push(info);world.location.origin=info.target.documentIds?(info.args[1]?.ordinal!==undefined?info.args[0]:info.args[2]):(info.args.length===4?info.args[0]:info.args[2]);world.location.href=world.location.origin+'/page';const func=vm.runInContext(`(${info.func.toString()})`,world);if(info.func.toString().includes('const ok=!!e')&&uploadMismatch)fileEl.files=[];return[{documentId:'doc-1',result:func(...info.args)}]}}};
   vm.runInNewContext(source,{chrome,URL,Map,Object,Array,Number,Boolean,String,Error,Date,JSON,console,setTimeout,crypto:{randomUUID:()=>`nonce-${Math.random()}`}});
  const request=async(project,session,op,params={})=>{const req={v:2,id:String(responses.length),ctx:{project,session},op,params};await ev.native[0](req);return responses.at(-1)};
  const message=async m=>{let result;ev.message[0](m,{id:'extension-id',url:'chrome-extension://extension-id/popup.html'},x=>{result=x});for(let i=0;i<30&&!result;i++)await new Promise(r=>setImmediate(r));return result;};
   return{request,message,calls,store,local,events:ev,element:el,fileEl,tabs};
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
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.permissionRemovals)),[{origins:['https://ok.test/*']},{permissions:['debugger']}]);
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
test('click consent is a separate, nonce-bound popup grant',async()=>{
 const key='["P","ses_A"]',h=harness({grants:{[key]:{project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']}}});
 await h.request('P','ses_A','group.status',{requestClick:true});
 const state=await h.message({type:'get-state'}),request=state.grants[0].clickRequest;
 assert.deepEqual(JSON.parse(JSON.stringify(request.origins)),['https://ok.test']);assert.ok(request.nonce);
 assert.equal((await h.message({type:'grant-click',key,nonce:'wrong'})).error!==undefined,true);
 assert.ok((await h.request('P','ses_A','tab.click',{handle:1,snapshotId:'x',ref:'e1'})).error);
 const result=await h.message({type:'grant-click',key,nonce:request.nonce});assert.equal(result.ok,true);
  assert.deepEqual(Array.from(h.store[key].click.origins),['https://ok.test']);assert.ok(h.store[key].click.expiresAt>Date.now());
 await h.message({type:'revoke-click',key});assert.equal(h.store[key].click,undefined);
});

const clickGrant={project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test'],click:{scope:'interact-v2',origins:['https://ok.test'],expiresAt:Date.now()+60000}};
async function clickHarness(options={}){const h=harness({tabs:[{id:1,groupId:7,windowId:1,url:'https://ok.test/page',active:false}],grants:{'["P","ses_A"]':clickGrant},...options});const snap=await h.request('P','ses_A','tab.snapshot',{handle:1});return{...h,snap};}
test('snapshot click uses documentId, succeeds once, and exposes no destinations',async()=>{
 const h=await clickHarness();assert.equal(h.snap.ok,true,JSON.stringify(h.snap));const item=h.snap.result.elements[0];assert.equal(item.ref,'e1');assert.equal('href' in item,false);assert.equal('formaction' in item,false);
 const args={handle:1,snapshotId:h.snap.result.snapshotId,ref:'e1'};assert.equal((await h.request('P','ses_A','tab.click',args)).result.clicked,true);assert.equal(h.element.clicked,1);
 const injection=h.calls.scripts.at(-1);assert.deepEqual(Array.from(injection.target.documentIds),['doc-1']);assert.ok((await h.request('P','ses_A','tab.click',args)).error);assert.equal(h.element.clicked,1);
});
test('click rejects stale snapshots and different sessions but honors explicit grant on active tab',async()=>{
 const h=await clickHarness(),a={handle:1,snapshotId:h.snap.result.snapshotId,ref:'e1'};assert.ok((await h.request('P','ses_B','tab.click',a)).error);h.tabs[0].active=true;assert.equal((await h.request('P','ses_A','tab.click',a)).result.clicked,true);
});
test('click rejects cross-origin form and link destinations',async()=>{
 for(const element of [{tag:'BUTTON',formaction:'https://evil.test/'},{tag:'A',href:'https://evil.test/',methods:{closest(){return{getAttribute:k=>k==='href'?'https://evil.test/':null,hasAttribute:()=>false}}}}]){
  const h=await clickHarness({element}),args={handle:1,snapshotId:h.snap.result.snapshotId,ref:'e1'};assert.ok((await h.request('P','ses_A','tab.click',args)).error);assert.equal(h.element.clicked,undefined);
 }
});
test('click rejects changed descriptors',async()=>{
  const h=await clickHarness(),args={handle:1,snapshotId:h.snap.result.snapshotId,ref:'e1'};h.element.innerText='Changed';assert.equal((await h.request('P','ses_A','tab.click',args)).error.code,'E_STALE');assert.equal(h.element.clicked,undefined);
});

test('fill works in active tabs, is single-use and never echoes entered text',async()=>{
 const h=await clickHarness({element:{tag:'INPUT',type:'text',methods:{matches:s=>s.includes('input[type="text"]')}}});h.tabs[0].active=true;
 const args={handle:1,snapshotId:h.snap.result.snapshotId,ref:'e1',value:'sensitive marker'};
 const result=await h.request('P','ses_A','tab.fill',args);
 assert.deepEqual(JSON.parse(JSON.stringify(result.result)),{filled:true});assert.equal(h.element.value,args.value);assert.ok(!JSON.stringify(result).includes(args.value));
 assert.deepEqual(Array.from(h.calls.scripts.at(-1).target.documentIds),['doc-1']);assert.ok((await h.request('P','ses_A','tab.fill',args)).error);
});
test('fill rejects stale references and secret fields without exposing values',async()=>{
 const h=await clickHarness({element:{tag:'INPUT',type:'password'}}),args={handle:1,snapshotId:h.snap.result.snapshotId,ref:'e1',value:'secret marker'};
 const denied=await h.request('P','ses_A','tab.fill',args);assert.equal(denied.error.code,'E_DENIED');assert.ok(!JSON.stringify(denied).includes(args.value));
 const fresh=await h.request('P','ses_A','tab.snapshot',{handle:1});h.element.innerText='changed';
 assert.equal((await h.request('P','ses_A','tab.fill',{...args,snapshotId:fresh.result.snapshotId})).error.code,'E_STALE');
});

test('restores a persisted grant in a fresh worker only for its matching group and permission',async()=>{
 const key='["P","ses_A"]',grant={project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']},stored={['opencode-bridge-grant:'+key]:grant},tabs=[{id:1,groupId:7,windowId:1,url:'https://ok.test/page'}];
 const restored=harness({local:stored,tabs,groupTitle:'P · ses_A'});assert.equal((await restored.request('P','ses_A','tabs.list')).result.tabs.length,1);
 for(const options of [{tabs:[],groupGetError:Error('missing group')},{tabs,groupTitle:'Different'}]) {const rejected=harness({local:stored,tabs:[...options.tabs],groupGetError:options.groupGetError,groupTitle:options.groupTitle??'P · ses_A'});const response=await rejected.request('P','ses_A','tabs.list');assert.ok(response.error||response.result.tabs.length===0);assert.equal(rejected.local['opencode-bridge-grant:'+key],undefined);}
 const noPermission=harness({local:stored,tabs,groupTitle:'P · ses_A',permission:false}),denied=await noPermission.request('P','ses_A','tabs.list');assert.ok(denied.error||denied.result.tabs.length===0);
});

test('startup clears persisted grants but retains popup choice',async()=>{
 const key='["P","ses_A"]',grant={project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']},grantKey='opencode-bridge-grant:'+key;
 const h=harness({local:{[grantKey]:grant,'popup-choice':'remember'},tabs:[{id:1,groupId:7,windowId:1,url:'https://ok.test/'}],grants:{[key]:grant}});
 await h.events.startup[0]();assert.equal(h.local[grantKey],undefined);assert.equal(h.local['popup-choice'],'remember');assert.equal(h.store[key],undefined);
});

test('old click grant scope is rejected; newly consented interaction scope allows active tab',async()=>{
 const key='["P","ses_A"]',old={...clickGrant,click:{...clickGrant.click,scope:'old-click-scope'}};
 const h=await clickHarness({grants:{[key]:old}}),args={handle:1,snapshotId:h.snap.result.snapshotId,ref:'e1'};
 assert.ok((await h.request('P','ses_A','tab.click',args)).error);
 await h.request('P','ses_A','group.status',{requestClick:true});const state=await h.message({type:'get-state'}),nonce=state.grants[0].clickRequest.nonce;
 assert.equal((await h.message({type:'grant-click',key,nonce})).ok,true);
 h.tabs[0].active=true;const fresh=await h.request('P','ses_A','tab.snapshot',{handle:1});
 assert.equal((await h.request('P','ses_A','tab.click',{handle:1,snapshotId:fresh.result.snapshotId,ref:'e1'})).result.clicked,true);
});

test('visual consent is nonce-bound and screenshot is bounded JPEG with debugger detached',async()=>{
 const key='["P","ses_A"]',grant={...clickGrant},tabs=[{id:1,groupId:7,windowId:1,url:'https://ok.test/page'}];
 const h=harness({grants:{[key]:grant},tabs});
 const status=await h.request('P','ses_A','group.status',{requestVisual:true,handle:1});
 const nonce=status.result.visualRequest.nonce;
 assert.ok((await h.message({type:'grant-visual',key,nonce:'bad'})).error);
 assert.equal((await h.message({type:'grant-visual',key,nonce})).ok,true);
 const shot=await h.request('P','ses_A','tab.screenshot',{handle:1});
 assert.equal(shot.result.mimeType,'image/jpeg');assert.equal(shot.result.data,'jpeg-data');
 assert.deepEqual(h.calls.debugger.map(x=>x[0]),['attach','sendCommand','detach']);
 assert.equal(h.calls.debugger[1][2],'Page.captureScreenshot');
 assert.equal(Object.keys(h.calls.debugger).includes('sendCommand'),false);
});

test('visual consent requires debugger permission and screenshot rejects invalid grants, tabs and oversized data',async()=>{
 const key='["P","ses_A"]',base={...clickGrant},tabs=[{id:1,groupId:7,windowId:1,url:'https://ok.test/page'}];
 const noPermission=harness({grants:{[key]:base},tabs,debuggerPermission:false});
 const pending=await noPermission.request('P','ses_A','group.status',{requestVisual:true,handle:1});
 assert.ok((await noPermission.message({type:'grant-visual',key,nonce:pending.result.visualRequest.nonce})).error);
 for(const options of [
  {grants:{[key]:base}},
  {grants:{[key]:{...base,visual:{handle:1,origin:'https://ok.test',expiresAt:Date.now()-1}}}},
  {grants:{[key]:{...base,visual:{handle:2,origin:'https://ok.test',expiresAt:Date.now()+60000}}}},
  {grants:{[key]:{...base,visual:{handle:1,origin:'https://ok.test',expiresAt:Date.now()+60000}}},tabs:[{...tabs[0],groupId:8}]},
  {grants:{[key]:{...base,visual:{handle:1,origin:'https://ok.test',expiresAt:Date.now()+60000}}},screenshotData:'x'.repeat(500001)}
 ]) { const h=harness({...options,tabs:options.tabs||tabs});assert.ok((await h.request('P','ses_A','tab.screenshot',{handle:1})).error); }
});

test('upload snapshot proposes file metadata and popup lists the nonce-bound approval',async()=>{
 const key='["P","ses_A"]',h=harness({debuggerPermission:false,tabs:[{id:1,groupId:7,windowId:1,url:'https://ok.test/page'}],grants:{[key]:{project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']}}});
 const snap=await h.request('P','ses_A','tab.snapshot',{handle:1});assert.equal(snap.result.uploadTargets[0].ref,'f1');
 assert.equal((await h.request('P','ses_A','tab.upload.propose',{handle:1,snapshotId:snap.result.snapshotId,ref:'f1',stageId:'stage-a',name:'payload.txt',size:12,sha256:'a'.repeat(64),displayPath:'/tmp/payload.txt'})).result.proposed,true);
 const state=await h.message({type:'get-state'}),proposal=state.uploadPending[0];assert.equal(proposal.stageId,'stage-a');assert.equal(proposal.name,'payload.txt');assert.equal(proposal.size,12);
 assert.ok((await h.message({type:'grant-upload',key,stageId:'stage-a',nonce:proposal.nonce})).error);
});

async function uploadHarness(options={}){
 const key='["P","ses_A"]',h=harness({tabs:[{id:1,groupId:7,windowId:1,url:'https://ok.test/page'}],grants:{[key]:{project:'P',session:'ses_A',groupId:7,windowId:1,origins:['https://ok.test']}},...options});
 const snap=await h.request('P','ses_A','tab.snapshot',{handle:1});
 const params={handle:1,snapshotId:snap.result.snapshotId,ref:'f1',stageId:'stage-a',name:'payload.txt',size:12,sha256:'a'.repeat(64),stagedPath:'/tmp/payload.txt'};
 const proposal=await h.request('P','ses_A','tab.upload.propose',{...params,displayPath:'/tmp/payload.txt'});
 return{...h,key,snap,params,proposal};
}
test('approved upload attaches files through CDP and detaches debugger',async()=>{
 const h=await uploadHarness();assert.equal(h.proposal.result.proposed,true);
 const state=await h.message({type:'get-state'}),pending=state.uploadPending[0];
 assert.equal((await h.message({type:'grant-upload',key:h.key,stageId:'stage-a',nonce:pending.nonce})).ok,true);
 const result=await h.request('P','ses_A','tab.upload',h.params);
 assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(JSON.parse(JSON.stringify(result.result)),{attached:true,committed:true});
 assert.deepEqual(h.calls.debugger.map(x=>x[0]),['attach','sendCommand','sendCommand','sendCommand','sendCommand','detach']);
 assert.equal(h.calls.debugger[1][2],'DOM.getDocument');assert.equal(h.calls.debugger[2][2],'DOM.querySelectorAll');
 assert.equal(h.calls.debugger[4][2],'DOM.setFileInputFiles');assert.deepEqual(Array.from(h.calls.debugger[4][3].files),['/tmp/payload.txt']);
 assert.deepEqual(Array.from(h.calls.scripts.at(-1).target.documentIds),['doc-1']);
});
test('upload rejects unapproved, cross-origin forms and postcheck mismatches',async()=>{
 const unapproved=await uploadHarness();assert.ok((await unapproved.request('P','ses_A','tab.upload',unapproved.params)).error);assert.deepEqual(unapproved.calls.debugger,[]);
 const cross=await uploadHarness({fileInput:{form:{action:'https://evil.test/upload',target:''}}});
 assert.ok(cross.proposal.error);assert.deepEqual(cross.calls.debugger,[]);
 const mismatch=await uploadHarness({uploadMismatch:true}),state=await mismatch.message({type:'get-state'}),pending=state.uploadPending[0];
 await mismatch.message({type:'grant-upload',key:mismatch.key,stageId:'stage-a',nonce:pending.nonce});
 const result=await mismatch.request('P','ses_A','tab.upload',mismatch.params);
  assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,'E_UPLOAD');assert.match(result.error.message,/page may already have read it/);
 assert.equal(mismatch.calls.debugger.at(-1)[0],'detach');
});
