const HOST = "dev.opencode.brave_bridge";
const MAX_TEXT = 12000, MAX_ELEMENTS = 150, PENDING_TTL = 10 * 60 * 1000, MAX_PENDING = 50;
const grants = new Map(); // pair-key -> {project,session,groupId,windowId,origins[]}
const pending = new Map();
let nativePort, nativeError = '', grantQueue = Promise.resolve();
const keyOf = (project, session) => JSON.stringify([project, session]);
const validPair = (p, s) => typeof p === 'string' && !!p && p.length <= 512 && typeof s === 'string' && !!s && s.length <= 256;
const label = (project, session) => `${project.split(/[\\/]/).filter(Boolean).pop() || project} · ${session.slice(0, 10)}`;
const ready = chrome.storage.session.get(null).then(values => {
  for (const [key, grant] of Object.entries(values)) if (grant && Number.isInteger(grant.groupId) && Array.isArray(grant.origins)) grants.set(key, grant);
});
function originOf(value) {
  try { const u = new URL(value); if (u.protocol === 'https:') return u.origin; if (u.protocol === 'http:' && u.hostname === '127.0.0.1') return u.origin; } catch {} return null;
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
  for (const [key,g] of grants) if(g.groupId===group.id) { grants.delete(key); await chrome.storage.session.remove(key); }
});
chrome.runtime.onStartup.addListener(async()=>{ await ready; grants.clear(); pending.clear(); await chrome.storage.session.clear(); });
chrome.runtime.onInstalled.addListener(()=>{});
chrome.runtime.onConnect.addListener(()=>{});
chrome.runtime.onStartup.addListener(connectHost); chrome.runtime.onInstalled.addListener(connectHost); connectHost();
function connectHost(){
  if(nativePort)return;
  try {
    const port=chrome.runtime.connectNative(HOST);
    nativePort=port; nativeError='';
    port.onMessage.addListener(m=>handleRequest(port,m));
    port.onDisconnect.addListener(()=>{ nativeError=chrome.runtime.lastError?.message||'Native host disconnected'; if(nativePort===port)nativePort=null; });
  } catch(e) { nativeError=String(e?.message||e); nativePort=null; }
}
async function handleRequest(port,req) {
  if(!req||req.v!==2||typeof req.id!=='string'||req.id.length>256)return;
  try {
    await ready; const {project,session}=req.ctx||{}, params=req.params||{}, {handle,url}=params;
    if(!validPair(project,session))throw fail('E_ARGS','Invalid project/session');
    const key=keyOf(project,session);
    if(req.op==='group.status') {
      cleanupPending(); const grant=grants.get(key);
      if(!grant)pending.set(key,{project,session,time:Date.now()});
      if(grant) { try { const group=await chrome.tabGroups.get(grant.groupId); respond(port,req,{authorized:true,project,session,groupName:group.title||'',tabCount:(await chrome.tabs.query({})).filter(t=>t.groupId===grant.groupId&&originOf(t.url||'')&&grant.origins.includes(originOf(t.url||''))).length,origins:[...grant.origins]}); return; } catch { grants.delete(key); await chrome.storage.session.remove(key); } }
      respond(port,req,{authorized:false,project,session}); return;
    }
    const grant=grants.get(key); if(!grant)throw fail('E_DENIED','Session has no user grant');
    if(req.op==='tabs.list') { const tabs=[]; for(const t of await chrome.tabs.query({}))if(t.id!=null&&await authorized(key,t))tabs.push({handle:t.id,title:t.title||'',url:originOf(t.url)}); respond(port,req,{tabs}); return; }
    if(req.op==='tab.open') { const origin=originOf(url||''); if(!origin||!grant.origins.includes(origin)||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Origin is not approved'); const tab=await chrome.tabs.create({url,windowId:grant.windowId,active:false}); await chrome.tabs.group({tabIds:[tab.id],groupId:grant.groupId}); respond(port,req,{handle:tab.id}); return; }
    if(req.op==='tab.navigate') { const tab=await chrome.tabs.get(handle); if(!await authorized(key,tab))throw fail('E_DENIED','Tab is outside granted group/origin'); if(tab.active)throw fail('E_ACTIVE_TAB','Navigation of active tab disabled'); const origin=originOf(url||''); if(!origin||!grant.origins.includes(origin)||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Origin is not approved'); await chrome.tabs.update(handle,{url}); respond(port,req,{handle}); return; }
    if(req.op==='tab.snapshot') { const tab=await chrome.tabs.get(handle); if(!await authorized(key,tab))throw fail('E_DENIED','Tab is outside granted group/origin'); const expected=originOf(tab.url); const [{result}]=await chrome.scripting.executeScript({target:{tabId:handle},args:[expected,MAX_TEXT,MAX_ELEMENTS],func:(origin,maxText,maxEls)=>{if(location.origin!==origin)return{denied:true}; const secret=e=>e.matches('input[type=password],input[autocomplete*="password" i],input[autocomplete*="cc-" i],input[name*="token" i],input[name*="secret" i],input[name*="email" i],input[name*="phone" i]'); const text=document.body?.innerText||''; const elements=[...document.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3')].slice(0,maxEls).map((e,i)=>({ref:`e${i+1}`,tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||'',name:secret(e)?'[REDACTED]':(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').trim().slice(0,300)})); return{title:document.title,origin:location.origin,url:location.origin,text:text.slice(0,maxText),elements};}}); const cur=await chrome.tabs.get(handle); if(!result||result.denied||result.origin!==expected||originOf(cur.url||'')!==expected||!await authorized(key,cur))throw fail('E_DENIED','Tab origin changed during snapshot'); respond(port,req,{...result,title:(result.title||'').slice(0,500),url:expected}); return; }
    throw fail('E_OP','Unsupported operation');
  } catch(e){respond(port,req,null,e?.code?e:fail('E_OPERATION',String(e?.message||'Operation failed').slice(0,300)));}
}
chrome.runtime.onMessage.addListener((m,_s,send)=>{
  if(m?.type==='get-state'){if(!nativePort)connectHost();cleanupPending(); send({nativeConnected:!!nativePort,nativeError,pending:[...pending].map(([key,p])=>({key,project:p.project,session:p.session,label:label(p.project,p.session)})),grants:[...grants].map(([key,g])=>({key,project:g.project,session:g.session,label:label(g.project,g.session),origins:g.origins}))}); return false;}
  if(m?.type==='grant') { const task=grantQueue.then(()=>grantSelected(m.key,m.tabIds,m.origins)); grantQueue=task.catch(()=>{}); task.then(send,e=>send({error:String(e?.message||e)})); return true; }
  if(m?.type==='revoke') { const task=grantQueue.then(()=>revoke(m.key)); grantQueue=task.catch(()=>{}); task.then(send,e=>send({error:String(e?.message||e)})); return true; }
  return false;
});
async function grantSelected(key, tabIds, origins) {
  await ready; const prior=grants.get(key), p=pending.get(key)||prior; if(!p||!Array.isArray(tabIds)||!tabIds.length)throw Error('Select a pending or approved session and one or more tabs');
  const tabs=[];
  for(const id of [...new Set(tabIds)]) { if(!Number.isInteger(id))throw Error('Invalid tab id'); const t=await chrome.tabs.get(id), origin=originOf(t.url||''); if(!origin)throw Error('Unsupported tab origin'); tabs.push({...t,_origin:origin}); }
  const windowId=prior?.windowId??tabs[0].windowId; if(tabs.some(t=>t.windowId!==windowId))throw Error('Selected tabs must be in the same window');
  const owned=new Set([...grants].filter(([k])=>k!==key).map(([,g])=>g.groupId));
  if(tabs.some(t=>t.groupId>=0&&owned.has(t.groupId)))throw Error('Cannot take a tab from another session group');
  if(tabs.some(t=>t.groupId>=0&&(!prior||t.groupId!==prior.groupId)))throw Error('Cannot take a tab from an existing browser group');
  const selectedOrigins=[...new Set(tabs.map(t=>t._origin))]; if(JSON.stringify([...new Set(origins)].sort())!==JSON.stringify(selectedOrigins.slice().sort()))throw Error('Selected origins changed; retry approval');
  for(const origin of selectedOrigins)if(!await chrome.permissions.contains({origins:[origin+'/*']}))throw Error('Host permission missing');
  let groupId=prior?.groupId;
  if(prior) { await chrome.tabGroups.get(groupId); if(tabs.some(t=>t.groupId!==groupId))await chrome.tabs.group({tabIds:tabs.map(t=>t.id),groupId}); }
  else { groupId=await chrome.tabs.group({tabIds:tabs.map(t=>t.id)}); }
  const allOrigins=[...new Set([...(prior?.origins||[]),...selectedOrigins])]; const grant={project:p.project,session:p.session,groupId,windowId,origins:allOrigins};
  grants.set(key,grant); await chrome.storage.session.set({[key]:grant}); pending.delete(key);
  await chrome.tabGroups.update(groupId,{title:label(p.project,p.session)});
  return {ok:true,groupId,origins:selectedOrigins};
}
async function revoke(key){ await ready; const grant=grants.get(key); if(!grant)return{ok:true}; grants.delete(key); await chrome.storage.session.remove(key); for(const origin of grant.origins){const used=[...grants.values()].some(g=>g.origins.includes(origin)); if(!used)await chrome.permissions.remove({origins:[origin+'/*']});} return{ok:true}; }
