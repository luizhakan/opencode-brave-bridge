const HOST = "dev.opencode.brave_bridge";
const MAX_TEXT = 12000, MAX_ELEMENTS = 150, PENDING_TTL = 10 * 60 * 1000, MAX_PENDING = 50;
const grants = new Map(); // pair-key -> {project,session,groupId,windowId,origins[]}
const pending = new Map();
const clickPending = new Map(), snapshots = new Map();
const CLICK_TTL = 5 * 60 * 1000, CLICK_GRANT_TTL = 30 * 60 * 1000, SNAPSHOT_TTL = 90 * 1000;
const VISUAL_TTL = 30 * 60 * 1000, visualPending = new Map();
const UPLOAD_TTL=5*60*1000, uploadPending=new Map();
let nativePort, nativeReady = false, nativeError = '', grantQueue = Promise.resolve();
const keyOf = (project, session) => JSON.stringify([project, session]);
const LOCAL_PREFIX = 'opencode-bridge-grant:';
const validPair = (p, s) => typeof p === 'string' && !!p && p.length <= 512 && typeof s === 'string' && !!s && s.length <= 256;
const label = (project, session) => `${project.split(/[\\/]/).filter(Boolean).pop() || project} · ${session.slice(0, 10)}`;
const ready = (async () => {
  await chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
  const [values, saved] = await Promise.all([chrome.storage.session.get(null), chrome.storage.local.get(null)]);
  const invalidOrigins=[];
  for (const [key, grant] of Object.entries(values)) if (grant && Number.isInteger(grant.groupId) && Array.isArray(grant.origins)) grants.set(key, grant);
  for (const [storedKey, grant] of Object.entries(saved)) if (storedKey.startsWith(LOCAL_PREFIX)) {
    const key = storedKey.slice(LOCAL_PREFIX.length);
    if (grants.has(key) || !grant || !validPair(grant.project, grant.session) || key !== keyOf(grant.project, grant.session) || !Number.isInteger(grant.groupId) || !Array.isArray(grant.origins)) continue;
    try {
      const now=Date.now();
      if(grant.click?.scope!=='interact-v2'||grant.click.expiresAt<=now||grant.click.expiresAt>now+CLICK_GRANT_TTL)delete grant.click;
      if(grant.visual?.expiresAt<=now||grant.visual?.expiresAt>now+VISUAL_TTL)delete grant.visual;
      const group=await chrome.tabGroups.get(grant.groupId);
      if(group.title!==label(grant.project,grant.session))throw Error('group identity changed');
      if(grant.seedTabId!=null){const seed=await chrome.tabs.get(grant.seedTabId);if(seed.groupId!==grant.groupId||seed.url!==chrome.runtime.getURL('seed.html'))throw Error('seed identity changed');}
      for (const origin of grant.origins) if (originOf(origin) !== origin || !await chrome.permissions.contains({origins:[origin+'/*']})) throw Error('permission missing');
      grants.set(key, grant); await chrome.storage.session.set({[key]:grant});
    } catch { await chrome.storage.local.remove(storedKey); invalidOrigins.push(...grant.origins); }
  }
  await releaseOrigins([...new Set(invalidOrigins)]);
})();
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
  for (const [key,g] of grants) if(g.groupId===group.id) { grants.delete(key); uploadPending.delete(key); await chrome.storage.session.remove(key); await chrome.storage.local.remove(LOCAL_PREFIX+key); await releaseOrigins(g.origins); await releaseDebugger(); }
});
async function releaseOrigins(origins) { for(const origin of origins)if(![...grants.values()].some(g=>g.origins.includes(origin)))await chrome.permissions.remove({origins:[origin+'/*']}); }
async function releaseDebugger(){if(![...grants.values()].some(g=>g.visual?.expiresAt>Date.now())&&![...uploadPending.values()].some(p=>p.approved&&p.time+UPLOAD_TTL>Date.now()))await chrome.permissions.remove({permissions:['debugger']});}
chrome.runtime.onStartup.addListener(async()=>{ await ready; const origins=[...new Set([...grants.values()].flatMap(g=>g.origins))]; grants.clear(); pending.clear(); uploadPending.clear(); await chrome.storage.session.clear(); const local=await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(local).filter(k=>k.startsWith(LOCAL_PREFIX))); await releaseOrigins(origins); await releaseDebugger(); });
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
       if(params.requestClick===true && grant && (grant.click?.scope!=='interact-v2' || grant.click.expiresAt<=Date.now())) { const old=clickPending.get(key); if(!old || old.time+CLICK_TTL<Date.now() || JSON.stringify(old.origins)!==JSON.stringify(grant.origins))clickPending.set(key,{project,session,time:Date.now(),nonce:crypto.randomUUID(),origins:[...grant.origins]}); }
        if(params.requestVisual===true&&grant&&Number.isInteger(params.handle)){const tab=await chrome.tabs.get(params.handle);if(await authorized(key,tab)){const old=visualPending.get(key),origin=originOf(tab.url);if(!old||old.time+CLICK_TTL<Date.now()||old.handle!==tab.id||old.origin!==origin)visualPending.set(key,{handle:tab.id,origin,nonce:crypto.randomUUID(),time:Date.now()});}}
        { const origins=requestedOrigins(params.origins); const old=pending.get(key); if(!old && (!grant || origins.length))pending.set(key,{project,session,time:Date.now(),nonce:crypto.randomUUID(),origins}); else if(origins.length&&JSON.stringify(origins)!==JSON.stringify(old?.origins))pending.set(key,{project,session,time:Date.now(),nonce:crypto.randomUUID(),origins}); }
        if(grant) { try { const group=await chrome.tabGroups.get(grant.groupId); const proposed=pending.get(key),visual=visualPending.get(key); respond(port,req,{authorized:true,project,session,groupName:group.title||'',tabCount:(await chrome.tabs.query({})).filter(t=>t.groupId===grant.groupId&&originOf(t.url||'')&&grant.origins.includes(originOf(t.url||''))).length,origins:[...grant.origins],click:grant.click?.scope==='interact-v2'&&grant.click.expiresAt>Date.now()?{enabled:true,expiresAt:grant.click.expiresAt}:{enabled:false},visual:grant.visual?.expiresAt>Date.now()?{enabled:true,expiresAt:grant.visual.expiresAt,origin:grant.visual.origin,handle:grant.visual.handle}:{enabled:false},...(visual?{visualRequest:{handle:visual.handle,origin:visual.origin,nonce:visual.nonce}}:{}),...(proposed?.origins?.length?{requestedOrigins:[...proposed.origins],nonce:proposed.nonce}:{})}); return; } catch { grants.delete(key); await chrome.storage.session.remove(key); } }
       const proposed=pending.get(key); respond(port,req,{authorized:false,project,session,...(proposed?.origins?.length?{origins:[...proposed.origins],nonce:proposed.nonce}:{})}); return;
    }
    const grant=grants.get(key); if(!grant)throw fail('E_DENIED','Session has no user grant');
    if(req.op==='tabs.list') { const tabs=[]; for(const t of await chrome.tabs.query({}))if(t.id!=null&&await authorized(key,t))tabs.push({handle:t.id,title:t.title||'',url:originOf(t.url)}); respond(port,req,{tabs}); return; }
    if(req.op==='tab.open') { const origin=originOf(url||''); if(!origin||!grant.origins.includes(origin)||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Origin is not approved'); let group; try { group=await chrome.tabGroups.get(grant.groupId); } catch { throw fail('E_DENIED','Session group no longer exists'); } if(grants.get(key)!==grant||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Grant was revoked'); const tab=await chrome.tabs.create({url,windowId:group.windowId,active:false}); try { if(grants.get(key)!==grant)throw fail('E_DENIED','Grant was revoked'); await chrome.tabs.group({tabIds:[tab.id],groupId:grant.groupId}); } catch(e) { await chrome.tabs.remove(tab.id).catch(()=>{}); throw e; } respond(port,req,{handle:tab.id}); return; }
      if(req.op==='tab.navigate') { const tab=await chrome.tabs.get(handle); if(!await authorized(key,tab))throw fail('E_DENIED','Tab is outside granted group/origin'); const origin=originOf(url||''); if(!origin||!grant.origins.includes(origin)||!await chrome.permissions.contains({origins:[origin+'/*']}))throw fail('E_DENIED','Origin is not approved'); const current=await chrome.tabs.get(handle); if(grants.get(key)!==grant||!await authorized(key,current))throw fail('E_DENIED','Grant was revoked or tab moved'); await chrome.tabs.update(handle,{url}); respond(port,req,{handle}); return; }
      if(req.op==='tab.screenshot') {
        if(!Number.isInteger(handle)||!grant.visual||grant.visual.expiresAt<=Date.now()||grant.visual.handle!==handle||!await chrome.permissions.contains({permissions:['debugger']}))throw fail('E_DENIED','Visual permission not approved or expired');
        const tab=await chrome.tabs.get(handle),origin=originOf(tab.url||''),visual=grant.visual;
        if(!await authorized(key,tab)||origin!==visual.origin)throw fail('E_DENIED','Tab authorization changed');
        try { await chrome.debugger.attach({tabId:handle},'0.1'); const current=await chrome.tabs.get(handle);
          if(grants.get(key)!==grant||grant.visual!==visual||visual.expiresAt<=Date.now()||!await authorized(key,current)||originOf(current.url||'')!==visual.origin)throw fail('E_DENIED','Visual grant or tab changed');
          const image=await chrome.debugger.sendCommand({tabId:handle},'Page.captureScreenshot',{format:'jpeg',quality:45,captureBeyondViewport:false});const after=await chrome.tabs.get(handle);
          if(grants.get(key)!==grant||grant.visual!==visual||!await authorized(key,after)||originOf(after.url||'')!==visual.origin||typeof image?.data!=='string'||image.data.length>500000)throw fail('E_DENIED','Screenshot unavailable or tab changed');
          respond(port,req,{data:image.data,mimeType:'image/jpeg'});return;
        } finally { await chrome.debugger.detach({tabId:handle}).catch(()=>{}); }
      }
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
           const uploadTargets=[...document.querySelectorAll('input[type="file"]')].slice(0,16).map((e,i)=>({ref:`f${i+1}`,multiple:e.multiple,accept:e.accept,disabled:e.disabled,title:document.title,formActionOrigin:(()=>{try{return e.form?.action?new URL(e.form.action,location.href).origin:location.origin}catch{return null}})(),formTarget:e.form?.target||'',ordinal:i}));
          return{title:document.title,origin:location.origin,url:location.origin,text:(document.body?.innerText||'').slice(0,maxText),elements,uploadTargets,snapshotId:sid};
       }});
       const result=injection?.result, cur=await chrome.tabs.get(handle);
       if(!result||result.denied||result.origin!==expected||originOf(cur.url||'')!==expected||!await authorized(key,cur))throw fail('E_DENIED','Tab origin changed during snapshot');
       for(const [id,s] of snapshots)if(s.key===key&&s.handle===handle)snapshots.delete(id);
        snapshots.set(snapshotId,{key,handle,origin:expected,time:Date.now(),documentId:injection.documentId,uploadTargets:result.uploadTargets||[]});
       while(snapshots.size>64)snapshots.delete(snapshots.keys().next().value);
       respond(port,req,{...result,title:(result.title||'').slice(0,500),url:expected});return;
      }
      if(req.op==='tab.upload.propose') {
        const snap=snapshots.get(params.snapshotId), ref=params.ref;
        if(!snap||snap.key!==key||snap.handle!==handle||Date.now()-snap.time>SNAPSHOT_TTL||!snap.documentId)throw fail('E_STALE','Snapshot is stale or unavailable');
        const tab=await chrome.tabs.get(handle),origin=originOf(tab.url||'');
        if(!await authorized(key,tab)||origin!==snap.origin)throw fail('E_DENIED','Tab authorization changed');
        if(!/^f(?:[1-9]|1[0-6])$/.test(ref)||!snap.uploadTargets.some(t=>t.ref===ref)||typeof params.stageId!=='string'||!params.stageId||params.stageId.length>256||typeof params.name!=='string'||params.name.length>255||!Number.isSafeInteger(params.size)||params.size<0||!/^[a-f0-9]{64}$/i.test(params.sha256)||typeof params.displayPath!=='string'||params.displayPath.length>2048)throw fail('E_ARGS','Invalid upload proposal');
         const target=snap.uploadTargets.find(t=>t.ref===ref);if(!target||target.disabled||target.formActionOrigin!==origin||target.formTarget&&!['_self',''].includes(target.formTarget))throw fail('E_DENIED','File input is disabled or its form targets another origin/window');
         const proposal={key,handle,origin,documentId:snap.documentId,ref,uploadTarget:target,stageId:params.stageId,name:params.name,size:params.size,sha256:params.sha256.toLowerCase(),displayPath:params.displayPath,nonce:crypto.randomUUID(),time:Date.now()};uploadPending.set(key,proposal);
        respond(port,req,{proposed:true});return;
      }
       if(req.op==='tab.upload') {
        const p=uploadPending.get(key), snap=snapshots.get(params.snapshotId);
        if(!p||p.time+UPLOAD_TTL<Date.now()||!p.approved)throw fail('E_DENIED','File upload has not been approved');
        if(!snap||snap.key!==key||snap.handle!==handle||snap.documentId!==p.documentId||snap.origin!==p.origin||params.ref!==p.ref||params.stageId!==p.stageId||params.name!==p.name||params.size!==p.size||String(params.sha256).toLowerCase()!==p.sha256)throw fail('E_STALE','Upload proposal changed or is stale');
        const stagedPath=params.stagedPath;
         if(typeof stagedPath!=='string'||!stagedPath||stagedPath.length>4096||stagedPath.includes('\0')||!stagedPath.startsWith('/'))throw fail('E_ARGS','Invalid staged file path');
        const tab=await chrome.tabs.get(handle);if(!await authorized(key,tab)||originOf(tab.url||'')!==p.origin||tab.groupId!==grants.get(key)?.groupId)throw fail('E_DENIED','Upload tab authorization changed');
        uploadPending.delete(key);snapshots.delete(params.snapshotId);
        try { await chrome.debugger.attach({tabId:handle},'0.1');
           const cur=await chrome.tabs.get(handle);if(grants.get(key)!==grant||!p.approved||!await authorized(key,cur)||originOf(cur.url||'')!==p.origin)throw fail('E_DENIED','Upload tab changed or approval revoked');
           const doc=await chrome.debugger.sendCommand({tabId:handle},'DOM.getDocument',{depth:0,pierce:false});
          const nodes=await chrome.debugger.sendCommand({tabId:handle},'DOM.querySelectorAll',{nodeId:doc.root.nodeId,selector:'input[type="file"]'});
          const index=Number(p.ref.slice(1))-1;if(!nodes.nodeIds||nodes.nodeIds.length!==snap.uploadTargets.length||index>=nodes.nodeIds.length)throw fail('E_STALE','File input targets changed');
           for(let i=0;i<nodes.nodeIds.length;i++){const d=await chrome.debugger.sendCommand({tabId:handle},'DOM.describeNode',{nodeId:nodes.nodeIds[i]});const a=d.node?.attributes||[],attr=n=>{for(let j=0;j<a.length;j+=2)if(a[j]===n)return a[j+1]||'';return''},has=n=>a.some((v,j)=>j%2===0&&v===n);const old=snap.uploadTargets[i];if(d.node?.nodeName!=='INPUT'||attr('type')!=='file'||has('multiple')!==old.multiple||attr('accept')!==old.accept||has('disabled')!==old.disabled)throw fail('E_STALE','File input attributes changed');}
           const [before]=await chrome.scripting.executeScript({target:{tabId:handle,documentIds:[p.documentId]},args:[p.origin,p.uploadTarget],func:(origin,old)=>{if(location.origin!==origin)return false;const e=[...document.querySelectorAll('input[type="file"]')][old.ordinal];if(!e||e.disabled||e.multiple!==old.multiple||e.accept!==old.accept)return false;let actionOrigin=location.origin;try{if(e.form?.action)actionOrigin=new URL(e.form.action,location.href).origin}catch{return false}return actionOrigin===origin&&(e.form?.target||'')===old.formTarget;}});
           if(before?.result!==true||grants.get(key)!==grant||!p.approved||!await chrome.permissions.contains({permissions:['debugger']}))throw fail('E_STALE','Document, input or approval changed before attach');
           await chrome.debugger.sendCommand({tabId:handle},'DOM.setFileInputFiles',{files:[stagedPath],nodeId:nodes.nodeIds[index]});
           const [injection]=await chrome.scripting.executeScript({target:{tabId:handle,documentIds:[p.documentId]},args:[p.origin,p.uploadTarget,p.name,p.size],func:(origin,old,name,size)=>{if(location.origin!==origin)return{ok:false};const e=[...document.querySelectorAll('input[type="file"]')][old.ordinal],files=e?.files;const ok=!!e&&!e.disabled&&e.multiple===old.multiple&&e.accept===old.accept&&files?.length===1&&files[0].name===name&&files[0].size===size;if(!ok&&e){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;try{setter?.call(e,'')}catch{}}return{ok};}});
           if(injection?.result?.ok!==true){throw fail('E_UPLOAD','File was attached, but verification failed; the page may already have read it. Clearing was attempted.');}
        respond(port,req,{attached:true,committed:true});return;
        } finally { await chrome.debugger.detach({tabId:handle}).catch(()=>{}); await releaseDebugger(); }
      }
      if(req.op==='tab.click') {
       if(!Number.isInteger(handle)||typeof params.snapshotId!=='string'||!/^e[1-9]\d{0,2}$/.test(params.ref))throw fail('E_ARGS','Invalid click reference');
       const snap=snapshots.get(params.snapshotId);
       if(!snap||snap.key!==key||snap.handle!==handle||Date.now()-snap.time>SNAPSHOT_TTL||!snap.documentId)throw fail('E_STALE','Snapshot is stale or unavailable');
       const tab=await chrome.tabs.get(handle),origin=originOf(tab.url||''),click=grant.click;
        if(!click||click.scope!=='interact-v2'||click.expiresAt<=Date.now()||!click.origins.includes(origin))throw fail('E_DENIED','Interaction permission not approved');
       if(!await authorized(key,tab)||origin!==snap.origin)throw fail('E_DENIED','Tab authorization changed');
       const current=await chrome.tabs.get(handle);
        if(grants.get(key)!==grant||!await authorized(key,current)||originOf(current.url)!==snap.origin||grant.click!==click||click.expiresAt<=Date.now())throw fail('E_DENIED','Click grant or tab changed');
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
      if(req.op==='tab.fill') {
        if(!Number.isInteger(handle)||typeof params.snapshotId!=='string'||!/^e[1-9]\d{0,2}$/.test(params.ref)||typeof params.value!=='string'||params.value.length>2000)throw fail('E_ARGS','Invalid fill reference or value (maximum 2000 characters)');
        const snap=snapshots.get(params.snapshotId);
        if(!snap||snap.key!==key||snap.handle!==handle||Date.now()-snap.time>SNAPSHOT_TTL||!snap.documentId)throw fail('E_STALE','Snapshot is stale or unavailable');
        const tab=await chrome.tabs.get(handle),origin=originOf(tab.url||''),interaction=grant.click;
        if(!interaction||interaction.scope!=='interact-v2'||interaction.expiresAt<=Date.now()||!interaction.origins.includes(origin))throw fail('E_DENIED','Interaction permission not approved');
        if(!await authorized(key,tab)||origin!==snap.origin)throw fail('E_DENIED','Tab authorization changed');
        const current=await chrome.tabs.get(handle);
        if(grants.get(key)!==grant||!await authorized(key,current)||originOf(current.url)!==snap.origin||grant.click!==interaction||interaction.expiresAt<=Date.now())throw fail('E_DENIED','Interaction grant or tab changed');
        snapshots.delete(params.snapshotId);
        let injection;
        try {[injection]=await chrome.scripting.executeScript({target:{tabId:handle,documentIds:[snap.documentId]},args:[params.snapshotId,params.ref,snap.origin,params.value],func:(sid,ref,origin,value)=>{
          if(location.origin!==origin)return{error:'stale'};
          const s=globalThis.__bridgeClickSnapshot,item=s?.sid===sid?s.refs.get(ref):null,e=item?.element;if(!e||!e.isConnected)return{error:'stale'};
          const password=/password|one-time-code|otp|cc-|credit|card|token|secret|auth|email|phone|tel/i;
          const sensitive=e.matches('input[type=password],input[type=file],input[type=hidden]')||password.test([e.type,e.name,e.id,e.autocomplete,e.getAttribute('aria-label')||'',e.getAttribute('placeholder')||''].join(' '));
          const editable=e.matches('textarea,input[type="text"],input[type="search"],input[type="email"],input[type="tel"],input[type="url"],input:not([type])')||e.isContentEditable;
          const descriptor={tag:e.tagName.toLowerCase(),role:(e.getAttribute('role')||'').slice(0,80),name:sensitive?'[REDACTED]':(e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||'').trim().slice(0,300),href:(e.getAttribute('href')||'').slice(0,2048),formAction:(e.getAttribute('formaction')||'').slice(0,2048),formUrl:(e.form?.action||'').slice(0,2048),formTarget:(e.formTarget||e.form?.target||'').slice(0,80),type:(e.getAttribute('type')||'').slice(0,80)};
          if(Object.keys(descriptor).some(k=>descriptor[k]!==item.descriptor[k]))return{error:'stale'};
          if(sensitive)return{error:'secret'};
          if(!editable||e.disabled||e.readOnly||e.getAttribute('aria-disabled')==='true'||e.closest('[inert],[aria-hidden="true"]')||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden'||getComputedStyle(e).display==='none')return{error:'unsafe'};
          if(e.isContentEditable){e.textContent=value;}else{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;if(setter)setter.call(e,value);else e.value=value;}
          e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return{filled:true};
        }});}catch{throw fail('E_STALE','Document changed before fill');}
        if(!injection?.result?.filled)throw fail(injection?.result?.error==='secret'||injection?.result?.error==='unsafe'?'E_DENIED':'E_STALE',injection?.result?.error==='secret'?'Sensitive fields cannot be filled':'Target changed or is not an allowed editable field');
        respond(port,req,{filled:true});return;
      }
    throw fail('E_OP','Unsupported operation');
  } catch(e){respond(port,req,null,e?.code?e:fail('E_OPERATION',String(e?.message||'Operation failed').slice(0,300)));}
}
chrome.runtime.onMessage.addListener((m,sender,send)=>{
      if(m?.type==='get-state' && sender?.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('popup.html') && !sender.tab){
       (async()=>{const saved=await chrome.storage.session.get('__nativeError');if(!nativePort)connectHost();cleanupPending();const now=Date.now();for(const[k,p]of clickPending)if(now-p.time>CLICK_TTL)clickPending.delete(k);for(const[k,p]of visualPending)if(now-p.time>CLICK_TTL)visualPending.delete(k);for(const[k,p]of uploadPending)if(now-p.time>UPLOAD_TTL)uploadPending.delete(k);send({nativeConnected:nativeReady,nativeError:nativeError||saved.__nativeError||'',uploadPending:[...uploadPending].filter(([,p])=>p.time+UPLOAD_TTL>now).map(([key,p])=>({key,project:grants.get(key)?.project,session:grants.get(key)?.session,origin:p.origin,displayPath:p.displayPath,name:p.name,size:p.size,sha256:p.sha256,nonce:p.nonce,stageId:p.stageId,target:{title:p.uploadTarget.title,ref:p.ref,accept:p.uploadTarget.accept,formActionOrigin:p.uploadTarget.formActionOrigin}})),pending:[...pending].filter(([key])=>!grants.has(key)).map(([key,p])=>({key,project:p.project,session:p.session,label:label(p.project,p.session),origins:p.origins,nonce:p.nonce})),grants:[...grants].map(([key,g])=>({key,project:g.project,session:g.session,label:label(g.project,g.session),origins:g.origins,click:g.click?.scope==='interact-v2'&&g.click.expiresAt>now?{enabled:true,expiresAt:g.click.expiresAt}:{enabled:false},visual:g.visual?.expiresAt>now?{enabled:true,expiresAt:g.visual.expiresAt,origin:g.visual.origin,handle:g.visual.handle}:{enabled:false},...(pending.has(key)?{requestedOrigins:pending.get(key).origins,nonce:pending.get(key).nonce}:{}),...(clickPending.has(key)?{clickRequest:{nonce:clickPending.get(key).nonce,origins:clickPending.get(key).origins}}:{}),...(visualPending.has(key)?{visualRequest:visualPending.get(key)}:{})}))});})();
    return true;
  }
       if(['grant','revoke','grant-click','revoke-click','grant-visual','revoke-visual','grant-upload'].includes(m?.type) && sender?.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('popup.html') && !sender.tab) { const task=grantQueue.then(()=>m.type==='grant'?grantSelected(m.key,m.origins,m.nonce):m.type==='revoke'?revoke(m.key):m.type==='grant-click'?grantClick(m.key,m.nonce):m.type==='revoke-click'?revokeClick(m.key):m.type==='grant-visual'?grantVisual(m.key,m.nonce):m.type==='revoke-visual'?revokeVisual(m.key):grantUpload(m.key,m.stageId,m.nonce)); grantQueue=task.catch(()=>{}); task.then(send,e=>send({error:String(e?.message||e)})); return true; }
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
  const allOrigins=[...new Set([...(prior?.origins||[]),...approved])]; const grant={project:p.project,session:p.session,groupId,windowId:prior?.windowId??seed.windowId,seedTabId:prior?.seedTabId??seed?.id,origins:allOrigins,...(prior?.click?.expiresAt>Date.now()?{click:prior.click}:{}),...(prior?.visual?.expiresAt>Date.now()?{visual:prior.visual}:{})};
   await chrome.storage.session.set({[key]:grant}); await chrome.storage.local.set({[LOCAL_PREFIX+key]:grant}); grants.set(key,grant); if(pending.get(key)===proposal)pending.delete(key);
  } catch(e) { if(seed){await chrome.tabs.remove(seed.id).catch(()=>{});} throw e; }
  return {ok:true,groupId,origins:approved};
}
async function grantUpload(key,stageId,nonce){await ready;const p=uploadPending.get(key);if(!p||p.time+UPLOAD_TTL<Date.now()||p.stageId!==stageId||p.nonce!==nonce)throw Error('File approval expired or changed');const t=await chrome.tabs.get(p.handle);if(!await authorized(key,t)||originOf(t.url||'')!==p.origin)throw Error('Upload tab authorization changed');if(!await chrome.permissions.contains({permissions:['debugger']}))throw Error('Debugger permission unavailable');p.approved=true;p.time=Date.now();const timer=setTimeout(()=>releaseDebugger().catch(()=>{}),UPLOAD_TTL+100);timer.unref?.();return{ok:true};}
async function revoke(key){ await ready; uploadPending.delete(key);const grant=grants.get(key); if(!grant)return{ok:true}; grants.delete(key); await chrome.storage.session.remove(key); await chrome.storage.local.remove(LOCAL_PREFIX+key); if(grant.seedTabId!=null){try {const tab=await chrome.tabs.get(grant.seedTabId);if(tab.groupId===grant.groupId&&tab.url===chrome.runtime.getURL('seed.html'))await chrome.tabs.remove(tab.id);} catch {}} await releaseOrigins(grant.origins); await releaseDebugger(); return{ok:true}; }
async function grantClick(key,nonce){await ready;const g=grants.get(key),p=clickPending.get(key);if(!g||!p||p.nonce!==nonce||p.time+CLICK_TTL<Date.now()||JSON.stringify(p.origins)!==JSON.stringify(g.origins))throw Error('Interaction request expired or changed');await chrome.tabGroups.get(g.groupId);g.click={scope:'interact-v2',origins:[...p.origins],expiresAt:Date.now()+CLICK_GRANT_TTL};await chrome.storage.session.set({[key]:g});await chrome.storage.local.set({[LOCAL_PREFIX+key]:g});clickPending.delete(key);return{ok:true,expiresAt:g.click.expiresAt};}
async function revokeClick(key){await ready;const g=grants.get(key);if(g){delete g.click;await chrome.storage.session.set({[key]:g});await chrome.storage.local.set({[LOCAL_PREFIX+key]:g});}clickPending.delete(key);return{ok:true};}
async function grantVisual(key,nonce){await ready;const g=grants.get(key),p=visualPending.get(key);if(!g||!p||p.nonce!==nonce||p.time+CLICK_TTL<Date.now()||!await chrome.permissions.contains({permissions:['debugger']}))throw Error('Visual request expired or debugger permission unavailable');const tab=await chrome.tabs.get(p.handle);if(!await authorized(key,tab)||originOf(tab.url)!==p.origin)throw Error('Visual tab authorization changed');g.visual={handle:p.handle,origin:p.origin,expiresAt:Date.now()+VISUAL_TTL};await chrome.storage.session.set({[key]:g});await chrome.storage.local.set({[LOCAL_PREFIX+key]:g});visualPending.delete(key);return{ok:true,expiresAt:g.visual.expiresAt};}
async function revokeVisual(key){await ready;const g=grants.get(key);if(g){delete g.visual;await chrome.storage.session.set({[key]:g});await chrome.storage.local.set({[LOCAL_PREFIX+key]:g});}visualPending.delete(key);await releaseDebugger();return{ok:true};}
