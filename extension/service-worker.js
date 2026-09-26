const HOST = "dev.opencode.brave_bridge";
const MAX_TEXT = 12000;
const MAX_ELEMENTS = 150;
const grants = new Map(); // project -> { groupId, origins[] }
let pendingProject = "";
let nativePort;

chrome.runtime.onStartup.addListener(clearGrants);
chrome.runtime.onInstalled.addListener(clearGrants);
chrome.runtime.onConnect.addListener(() => {});
let ready = chrome.storage.session.get(null).then(values => {
  for (const [project, grant] of Object.entries(values)) {
    if (grant && Number.isInteger(grant.groupId) && Array.isArray(grant.origins)) grants.set(project, grant);
  }
});

async function clearGrants() {
  grants.clear();
  pendingProject = "";
  await chrome.storage.session.clear();
}

function originOf(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return null;
    } else if (u.protocol !== "https:") return null;
    return u.origin;
  } catch { return null; }
}

function grantFor(project) {
  if (typeof project !== "string" || !project || project.length > 512) return null;
  return grants.get(project) || null;
}

async function authorized(project, tab) {
  const grant = grantFor(project);
  if (!grant || !tab || tab.groupId !== grant.groupId) return false;
  const origin = originOf(tab.url || "");
  if (!origin || !grant.origins.includes(origin)) return false;
  const pattern = origin + "/*";
  return chrome.permissions.contains({ origins: [pattern] });
}

function fail(code, message) { return { code, message }; }
function respond(port, req, result, error) {
  try { port.postMessage({ v: 1, id: req.id, ok: !error, ...(error ? { error } : { result }) }); } catch {}
}

chrome.runtime.onStartup.addListener(connectHost);
chrome.runtime.onInstalled.addListener(connectHost);
connectHost();
function connectHost() {
  try {
    nativePort = chrome.runtime.connectNative(HOST);
    nativePort.onMessage.addListener(message => handleRequest(nativePort, message));
    nativePort.onDisconnect.addListener(() => { nativePort = null; });
  } catch { nativePort = null; }
}

async function handleRequest(port, req) {
  if (!req || req.v !== 1 || typeof req.id !== "string" || req.id.length > 256) return;
  try {
    await ready;
    const { project, handle, url } = req.params || {};
    if (req.op === "group.status") {
      if (typeof project !== "string" || !project || project.length > 512) throw fail("E_ARGS", "Invalid project");
      pendingProject = project;
      const grant = grantFor(project);
      respond(port, req, grant ? { authorized: true, groupName: (await chrome.tabGroups.get(grant.groupId)).title || "", origins: [...grant.origins] } : { authorized: false });
      return;
    }
    const grant = grantFor(project);
    if (!grant) throw fail("E_DENIED", "Project has no user grant");
    if (req.op === "tabs.list") {
      const tabs = (await chrome.tabs.query({})).filter(t => t.groupId === grant.groupId && t.id != null && authorized(project, t));
      respond(port, req, { tabs: tabs.map(t => ({ handle: t.id, title: t.title || "", url: t.url || "" })) });
      return;
    }
    if (req.op === "tab.open") {
      const origin = originOf(url || "");
      if (!origin || !grant.origins.includes(origin) || !(await chrome.permissions.contains({ origins: [origin + "/*"] }))) throw fail("E_DENIED", "Origin is not approved");
      const tab = await chrome.tabs.create({ url, active: false });
      await chrome.tabs.group({ tabIds: [tab.id], groupId: grant.groupId });
      respond(port, req, { handle: tab.id });
      return;
    }
    if (req.op === "tab.navigate") {
      const tab = await chrome.tabs.get(handle);
      if (!(await authorized(project, tab))) throw fail("E_DENIED", "Tab is outside the granted group or origin");
      const origin = originOf(url || "");
      if (!origin || !grant.origins.includes(origin) || !(await chrome.permissions.contains({ origins: [origin + "/*"] }))) throw fail("E_DENIED", "Origin is not approved");
      await chrome.tabs.update(handle, { url, active: false });
      respond(port, req, { handle });
      return;
    }
    if (req.op === "tab.snapshot") {
      const tab = await chrome.tabs.get(handle);
      if (!(await authorized(project, tab))) throw fail("E_DENIED", "Tab is outside the granted group or origin");
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: handle }, func: () => {
        const secret = el => el.matches('input[type="password"],input[autocomplete*="password" i],input[autocomplete*="cc-" i],input[name*="token" i],input[name*="secret" i],input[name*="email" i],input[name*="phone" i]');
        const text = document.body?.innerText || "";
        const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role],h1,h2,h3')].slice(0, 150).map((el, i) => ({ ref: `e${i + 1}`, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || "", name: secret(el) ? "[REDACTED]" : (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || "").trim().slice(0, 300) }));
        return { title: document.title, url: location.href, text: text.slice(0, 12000), elements };
      } });
      respond(port, req, { ...result, title: (result.title || "").slice(0, 500), url: (result.url || "").slice(0, 2048) });
      return;
    }
    throw fail("E_OP", "Unsupported operation");
  } catch (e) {
    respond(port, req, null, e?.code ? e : fail("E_OPERATION", String(e?.message || "Operation failed").slice(0, 300)));
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-state") sendResponse({ project: pendingProject, granted: Boolean(grantFor(pendingProject)) });
  if (message?.type === "grant") grantCurrent(message.project, message.origin).then(sendResponse, e => sendResponse({ error: String(e.message || e) }));
  if (message?.type === "revoke") { grants.delete(message.project); chrome.storage.session.remove(message.project); sendResponse({ ok: true }); }
  return true;
});

async function grantCurrent(project, requestedOrigin) {
  await ready;
  if (typeof project !== "string" || project !== pendingProject || !project) throw Error("No matching pending project");
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw Error("Select a normal web tab first");
  let origin = originOf(tab.url);
  if (requestedOrigin) {
    const candidate = originOf(requestedOrigin);
    if (!candidate) throw Error("Unsupported origin");
    origin = candidate;
  }
  if (!origin) throw Error("Only HTTPS and http://127.0.0.1 origins are allowed");
  const pattern = origin + "/*";
  if (!(await chrome.permissions.contains({ origins: [pattern] })) && !(await chrome.permissions.request({ origins: [pattern] }))) throw Error("Host permission was not granted");
  let groupId = tab.groupId;
  if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  const previous = grants.get(project);
  const origins = previous?.groupId === groupId ? [...previous.origins] : [];
  if (!origins.includes(origin)) origins.push(origin);
  const grant = { groupId, origins };
  grants.set(project, grant);
  await chrome.storage.session.set({ [project]: grant });
  return { ok: true, groupId, origin };
}
