const HOST = "dev.opencode.brave_bridge";
const MAX_TEXT = 12000, MAX_ELEMENTS = 150, PENDING_TTL = 10 * 60 * 1000, MAX_PENDING = 50;
const grants = new Map(); // pair-key -> {project,session,groupId,windowId,origins[]}
const pending = new Map();
const clickPending = new Map(), snapshots = new Map();
const CLICK_TTL = 5 * 60 * 1000, CLICK_GRANT_TTL = 30 * 60 * 1000, SNAPSHOT_TTL = 90 * 1000;
let nativePort, nativeReady = false, nativeError = '', grantQueue = Promise.resolve();
const keyOf = (project, session) => JSON.stringify([project, session]);
const validPair = (p, s) => typeof p === 'string' && !!p && p.length <= 512 && typeof s === 'string' && !!s && s.length <= 256;
const label = (project, session) => `${project.split(/[\\/]/).filter(Boolean).pop() || project} · ${session.slice(0, 10)}`;
const ready = chrome.storage.session.get(null).then(values => {
  for (const [key, grant] of Object.entries(values)) if (grant && Number.isInteger(grant.groupId) && Array.isArray(grant.origins)) grants.set(key, grant);
});
function originOf(value) {
  try { const u = new URL(value); if (u.username || u.password) return null; if (u.protocol === 'https:') return u.origin; if (u.protocol === 'http:' && u.hostname === '127.0.0.1') return u.origin; } catch {} return null;
}
function requestedOrigins(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 20) throw fail('E_ARGS','Expected at most 20 valid HTTPS/loopback origins');
  const out=[]; for(const value of values){const origin=originOf(value); if(!origin||new URL(value).origin!==value) throw fail('E_ARGS','Invalid origin proposal'); if(!out.includes(origin))out.push(origin);} return out;
}
function fail(code, message) { return {code,message}; }
function respond(port, req, result, error) { try { port.postMessage({v:2,id:req.id,ok:!error,...(error?{error}:{result})}); } catch {} }
async function authorized(key, tab) {
  const g=grants.get(key), origin=originOf(tab?.url||'');
  return !!(g && tab && tab.groupId===g.groupId && origin && g.origins.includes(origin) && await chrome.permissions.contains({origins:[origin+'/*']}));
}
function cleanupPending() { const now=Date.now(); for (const [k,v] of pending) if (now-v.time>PENDING_TTL) pending.delete(k); while(pending.size>MAX_PENDING) pending.delete(pending.keys().next().value); }
chrome.tabGroups.onRemoved.addListener(async group => {
  await ready;
  for (const [key,g] of grants) if(g.groupId===group.id) { grants.delete(key); await chrome.storage.session.remove(key); await releaseOrigins(g.origins); }
});
async function releaseOrigins(origins) { for(const origin of origins)if(![...grants.values()].some(g=>g.origins.includes(origin)))await chrome.permissions.remove({origins:[origin+'/*']}); }
chrome.runtime.onStartup.addListener(async()=>{ await ready; const origins=[...new Set([...grants.values()].flatMap(g=>g.origins))]; grants.clear(); pending.clear(); await chrome.storage.session.clear(); await releaseOrigins(origins); });
chrome.runtime.onInstalled.addListener(()=>{});
chrome.runtime.onConnect.addListener(()=>{});
chrome.runtime.onStartup.addListener(connectHost); chrome.runtime.onInstalled.addListener(connectHost); connectHost();
function connectHost(){
  if(nativePort)return;
  try {
    const port=chrome.runtime.connectNative(HOST);
    nativePort=port; nativeReady=false;
    port.onMessage.addListener(m=>{ if(m?.event==='ready'&&m.v===2){nativeReady=true;nativeError='';chrome.storage.session.remove('__nativeError');return;} return handleRequest(port,m); });
    port.onDisconnect.addListener(()=>{ nativeError=chrome.runtime.lastError?.message||'Native host disconnected'; chrome.storage.session.set({__nativeError:nativeError}); if(nativePort===port){nativePort=null;nativeReady=false;} });
  } catch(e) { nativeError=String(e?.message||e);chrome.storage.session.set({__nativeError:nativeError});nativePort=null; }
}
async function handleRequest(port,req) {
  if(!req||req.v!==2||typeof req.id!=='string'||req.id.length>256)return;
  try {
    await ready; const {project,session}=req.ctx||{}, params=req.params||{}, {handle,url}=params;
    if(!validPair(project,session))throw fail('E_ARGS','Invalid project/session');
    const key=keyOf(project,session);
     if(req.op==='group.status') {
       cleanupPending(); const grant=grants.get(key);
       if(params.requestClick===true && grant && (!grant.click || grant.click.expiresAt<=Date.now())) { const old=clickPending.get(key); if(!old || old.time+CLICK_TTL<Date.now() || JSON.stringify(old.origins)!==JSON.stringify(grant.origins))clickPending.set(key,{project,session,time:Date.now(),nonce:crypto.randomUUID(),origins:[...grant.origins]}); }
       { const origins=requestedOrigins(params.origins); const old=pending.get(key); if(!old && (!grant || origins.length))pending.set(key,{project,session,time:Date.now(),nonce:crypto.randomUUID(),origins}); else if(origins.length&&JSON.stringify(origins)!==JSON.stringify(old?.origins))pending.set(key,{project,session,time:Date.now(),nonce:crypto.randomUUID(),origins}); }
        if(grant) { try { const group=await chrome.tabGroups.get(grant.groupId); const proposed=pending.get(key); respond(port,req,{authorized:true,project,session,groupName:group.title||'',tabCount:(await chrome.tabs.query({})).filter(t=>t.groupId===grant.groupId&&originOf(t.url||'')&&grant.origins.includes(originOf(t.url||''))).length,origins:[...grant.origins],click:grant.click?.expiresAt>Date.now()?{enabled:true,expiresAt:grant.click.expiresAt}:{enabled:false},...(proposed?.origins?.length?{requestedOrigins:[...proposed.origins],nonce:proposed.nonce}:{})}); return; } catch { grants.delete(key); await chrome.storage.session.remove(key); } }
       const proposed=pending.get(key); respond(port,req,{authorized:false,project,session,...(proposed?.origins?.length?{origins:[...proposed.origins],nonce:proposed.nonce}:{})}); return;
    }
    const grant=grants.get(key); if(!grant)throw fail('E_DENIED','Session has no user grant');
    if(req.op==='tabs.list') { const tabs=[]; for(const t of await chrome.tabs.query({}))if(t.id!=null&&await authorized(key,t))tabs.push({handle:t.id,title:t.title||'',url:originOf(t.url)}); respond(port,req,{tabs}); return; }
    if(req.op==='tab.open') { const origin=originOf(url||''); if(!origin||!grant.origins.includes(origin)||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Origin is not approved'); let group; try { group=await chrome.tabGroups.get(grant.groupId); } catch { throw fail('E_DENIED','Session group no longer exists'); } if(grants.get(key)!==grant||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Grant was revoked'); const tab=await chrome.tabs.create({url,windowId:group.windowId,active:false}); try { if(grants.get(key)!==grant)throw fail('E_DENIED','Grant was revoked'); await chrome.tabs.group({tabIds:[tab.id],groupId:grant.groupId}); } catch(e) { await chrome.tabs.remove(tab.id).catch(()=>{}); throw e; } respond(port,req,{handle:tab.id}); return; }
    if(req.op==='tab.navigate') { const tab=await chrome.tabs.get(handle); if(!await authorized(key,tab))throw fail('E_DENIED','Tab is outside granted group/origin'); const origin=originOf(url||''); if(!origin||!grant.origins.includes(origin)||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Origin is not approved'); const current=await chrome.tabs.get(handle); if(grants.get(key)!==grant||!await authorized(key,current))throw fail('E_DENIED','Grant was revoked or tab moved'); if(current.active)throw fail('E_ACTIVE_TAB','Navigation of active tab disabled'); await chrome.tabs.update(handle,{url}); respond(port,req,{handle}); return; }
     if(req.op==='tab.snapshot') {
       const tab=await chrome.tabs.get(handle);
       if(!await authorized(key,tab))throw fail('E_DENIED','Tab is outside granted group/origin');
       const expected=originOf(tab.url), snapshotId=crypto.randomUUID();
       const [injection]=await chrome.scripting.executeScript({target:{tabId:handle},args:[expected,MAX_TEXT,MAX_ELEMENTS,snapshotId],func:(origin,maxText,maxElements,sid)=>{
         if(location.origin!==origin)return{denied:true};
         const secret=e=>e.matches('input[type=password],input[type=file],input[autocomplete*="password" i],input[autocomplete*="cc-" i],input[name*="token" i],input[name*="secret" i],input[name*="email" i],input[name*="phone" i]');
         const describe=e=>({tag:e.tagName.toLowerCase(),role:(e.getAttribute('role')||'').slice(0,80),name:secret(e)?'[REDACTED]':(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').trim().slice(0,300),href:(e.getAttribute('href')||'').slice(0,2048),formAction:(e.getAttribute('formaction')||'').slice(0,2048),formUrl:(e.form?.action||'').slice(0,2048),formTarget:(e.formTarget||e.form?.target||'').slice(0,80),type:(e.getAttribute('type')||'').slice(0,80)});
         const visible=e=>!!e.getClientRects().length&&!e.closest('[inert],[aria-hidden="true"]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
         const refs=new Map(),elements=[];
         for(const e of document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="switch"]')){
           if(elements.length>=maxElements)break;
           if(!visible(e))continue;
           const ref=`e${elements.length+1}`,descriptor=describe(e);
           refs.set(ref,{element:e,descriptor});elements.push({ref,tag:descriptor.tag,role:descriptor.role,name:descriptor.name,disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true'});
         }
         globalThis.__bridgeClickSnapshot={sid,origin,refs};
         return{title:document.title,origin:location.origin,url:location.origin,text:(document.body?.innerText||'').slice(0,maxText),elements,snapshotId:sid};
       }});
       const result=injection?.result, cur=await chrome.tabs.get(handle);
       if(!result||result.denied||result.origin!==expected||originOf(cur.url||'')!==expected||!await authorized(key,cur))throw fail('E_DENIED','Tab origin changed during snapshot');
       for(const [id,s] of snapshots)if(s.key===key&&s.handle===handle)snapshots.delete(id);
       snapshots.set(snapshotId,{key,handle,origin:expected,time:Date.now(),documentId:injection.documentId});
       while(snapshots.size>64)snapshots.delete(snapshots.keys().next().value);
       respond(port,req,{...result,title:(result.title||'').slice(0,500),url:expected});return;
     }
     if(req.op==='tab.click') {
       if(!Number.isInteger(handle)||typeof params.snapshotId!=='string'||!/^e[1-9]\d{0,2}$/.test(params.ref))throw fail('E_ARGS','Invalid click reference');
       const snap=snapshots.get(params.snapshotId);
       if(!snap||snap.key!==key||snap.handle!==handle||Date.now()-snap.time>SNAPSHOT_TTL||!snap.documentId)throw fail('E_STALE','Snapshot is stale or unavailable');
       const tab=await chrome.tabs.get(handle),origin=originOf(tab.url||''),click=grant.click;
       if(!click||click.expiresAt<=Date.now()||!click.origins.includes(origin))throw fail('E_DENIED','Click permission not approved');
       if(tab.active)throw fail('E_ACTIVE_TAB','Click on active tab disabled');
       if(!await authorized(key,tab)||origin!==snap.origin)throw fail('E_DENIED','Tab authorization changed');
       const current=await chrome.tabs.get(handle);
       if(current.active||grants.get(key)!==grant||!await authorized(key,current)||originOf(current.url)!==snap.origin||grant.click!==click||click.expiresAt<=Date.now())throw fail('E_DENIED','Click grant or tab changed');
       snapshots.delete(params.snapshotId);
       let injection;
       try { [injection]=await chrome.scripting.executeScript({target:{tabId:handle,documentIds:[snap.documentId]},args:[params.snapshotId,params.ref,snap.origin],func:(sid,ref,origin)=>{
         if(location.origin!==origin)return{error:'stale'};
         const s=globalThis.__bridgeClickSnapshot,item=s?.sid===sid?s.refs.get(ref):null,e=item?.element;
         if(!e||!e.isConnected)return{error:'stale'};
         const secret=e.matches('input[type=password],input[type=file],input[autocomplete*="password" i],input[autocomplete*="cc-" i],input[name*="token" i],input[name*="secret" i],input[name*="email" i],input[name*="phone" i]');
         const descriptor={tag:e.tagName.toLowerCase(),role:(e.getAttribute('role')||'').slice(0,80),name:secret?'[REDACTED]':(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').trim().slice(0,300),href:(e.getAttribute('href')||'').slice(0,2048),formAction:(e.getAttribute('formaction')||'').slice(0,2048),formUrl:(e.form?.action||'').slice(0,2048),formTarget:(e.formTarget||e.form?.target||'').slice(0,80),type:(e.getAttribute('type')||'').slice(0,80)};
         if(Object.keys(descriptor).some(k=>descriptor[k]!==item.descriptor[k]))return{error:'stale'};
         if(secret||e.disabled||e.getAttribute('aria-disabled')==='true'||e.closest('[inert],[aria-hidden="true"]')||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden'||getComputedStyle(e).display==='none')return{error:'unsafe'};
         if(e.hasAttribute('download')||e.getAttribute('target')&&!['_self',''].includes(e.getAttribute('target'))||e.hasAttribute('ping')||descriptor.formTarget&&!['_self',''].includes(descriptor.formTarget))return{error:'unsafe'};
         const target=e.closest('a[href],form[action]');
         if(target){const u=new URL(target.getAttribute('href')||target.getAttribute('action'),location.href);if(!['https:','http:'].includes(u.protocol)||u.origin!==origin||target.hasAttribute('download')||target.hasAttribute('ping')||target.getAttribute('target')&&!['_self',''].includes(target.getAttribute('target')))return{error:'unsafe'};}
         for(const destination of [e.form?.action,e.formAction,e.getAttribute('formaction')].filter(Boolean)){const u=new URL(destination,location.href);if(u.origin!==origin||!['https:','http:'].includes(u.protocol))return{error:'unsafe'};}
         e.click();return{clicked:true,name:descriptor.name};
       }}); } catch { throw fail('E_STALE','Document changed before click'); }
       if(!injection?.result?.clicked)throw fail(injection?.result?.error==='unsafe'?'E_DENIED':'E_STALE',injection?.result?.error==='unsafe'?'Target is not allowed':'Target changed since snapshot');
       const after=await chrome.tabs.get(handle).catch(()=>null);
       respond(port,req,{clicked:true,name:injection.result.name,originStillApproved:!!(after&&grants.get(key)===grant&&await authorized(key,after))});return;
     }
    throw fail('E_OP','Unsupported operation');
  } catch(e){respond(port,req,null,e?.code?e:fail('E_OPERATION',String(e?.message||'Operation failed').slice(0,300)));}
}
chrome.runtime.onMessage.addListener((m,sender,send)=>{
      if(m?.type==='get-state' && sender?.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('popup.html') && !sender.tab){
      (async()=>{const saved=await chrome.storage.session.get('__nativeError');if(!nativePort)connectHost();cleanupPending();const now=Date.now();for(const[k,p]of clickPending)if(now-p.time>CLICK_TTL)clickPending.delete(k);send({nativeConnected:nativeReady,nativeError:nativeError||saved.__nativeError||'',pending:[...pending].filter(([key])=>!grants.has(key)).map(([key,p])=>({key,project:p.project,session:p.session,label:label(p.project,p.session),origins:p.origins,nonce:p.nonce})),grants:[...grants].map(([key,g])=>({key,project:g.project,session:g.session,label:label(g.project,g.session),origins:g.origins,click:g.click?.expiresAt>now?{enabled:true,expiresAt:g.click.expiresAt}:{enabled:false},...(pending.has(key)?{requestedOrigins:pending.get(key).origins,nonce:pending.get(key).nonce}:{}),...(clickPending.has(key)?{clickRequest:{nonce:clickPending.get(key).nonce,origins:clickPending.get(key).origins}}:{})}))});})();
    return true;
  }
    if(['grant','revoke','grant-click','revoke-click'].includes(m?.type) && sender?.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('popup.html') && !sender.tab) { const task=grantQueue.then(()=>m.type==='grant'?grantSelected(m.key,m.origins,m.nonce):m.type==='revoke'?revoke(m.key):m.type==='grant-click'?grantClick(m.key,m.nonce):revokeClick(m.key)); grantQueue=task.catch(()=>{}); task.then(send,e=>send({error:String(e?.message||e)})); return true; }
  return false;
});
async function grantSelected(key, origins, nonce) {
  await ready; const prior=grants.get(key), proposal=pending.get(key), p=proposal||null, approved=requestedOrigins(origins); if(!p||!approved.length)throw Error('No origins proposed for approval');
  if(proposal.nonce!==nonce||JSON.stringify(approved)!==JSON.stringify(proposal.origins))throw Error('Pending origin proposal changed; retry preview');
  for(const origin of approved)if(!await chrome.permissions.contains({origins:[origin+'/*']}))throw Error('Host permission missing');
  let groupId=prior?.groupId, seed;
  if(prior) await chrome.tabGroups.get(groupId);
  else { const wins=await chrome.windows.getAll({windowTypes:['normal']}); const win=wins.find(w=>w.focused)||wins[0]; if(!win)throw Error('No normal browser window'); seed=await chrome.tabs.create({url:chrome.runtime.getURL('seed.html'),windowId:win.id,active:false}); }
  try {
  if(!prior)groupId=await chrome.tabs.group({tabIds:[seed.id]});
  await chrome.tabGroups.update(groupId,{title:label(p.project,p.session)});
  const allOrigins=[...new Set([...(prior?.origins||[]),...approved])]; const grant={project:p.project,session:p.session,groupId,windowId:prior?.windowId??seed.windowId,seedTabId:prior?.seedTabId??seed?.id,origins:allOrigins};
  await chrome.storage.session.set({[key]:grant}); grants.set(key,grant); if(pending.get(key)===proposal)pending.delete(key);
  } catch(e) { if(seed){await chrome.tabs.remove(seed.id).catch(()=>{});} throw e; }
  return {ok:true,groupId,origins:approved};
}
async function revoke(key){ await ready; const grant=grants.get(key); if(!grant)return{ok:true}; grants.delete(key); await chrome.storage.session.remove(key); if(grant.seedTabId!=null){try {const tab=await chrome.tabs.get(grant.seedTabId);if(tab.groupId===grant.groupId&&tab.url===chrome.runtime.getURL('seed.html'))await chrome.tabs.remove(tab.id);} catch {}} await releaseOrigins(grant.origins); return{ok:true}; }
async function grantClick(key,nonce){await ready;const g=grants.get(key),p=clickPending.get(key);if(!g||!p||p.nonce!==nonce||p.time+CLICK_TTL<Date.now()||JSON.stringify(p.origins)!==JSON.stringify(g.origins))throw Error('Click request expired or changed');await chrome.tabGroups.get(g.groupId);g.click={origins:[...p.origins],expiresAt:Date.now()+CLICK_GRANT_TTL};await chrome.storage.session.set({[key]:g});clickPending.delete(key);return{ok:true,expiresAt:g.click.expiresAt};}
async function revokeClick(key){await ready;const g=grants.get(key);if(g){delete g.click;await chrome.storage.session.set({[key]:g});}clickPending.delete(key);return{ok:true};}
