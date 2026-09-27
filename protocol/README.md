# Bridge protocol v2 — macOS preview

The extension initiates `chrome.runtime.connectNative('dev.opencode.brave_bridge')`.
Chromium native messaging uses a four-byte little-endian length followed by UTF-8 JSON. The host exchanges newline-delimited JSON with MCP processes over a private Unix socket (named pipe on Windows, not yet validated). No TCP listener.

Requests: `{ "v": 2, "id": "opaque", "op": "group.status", "ctx": { "project": "/git/root", "session": "ses_..." }, "params": {} }`.
Responses: `{ "v": 2, "id": "opaque", "ok": true, "result": { ... } }` or `{ "v": 2, "id": "opaque", "ok": false, "error": { "code": "E_...", "message": "..." } }`.

The MCP process derives `project` from its cwd, `session` from OpenCode's `tools/call` `_meta.sessionID`; where unavailable it uses a random identifier scoped to that MCP process. Both values are routing hints, **not authentication** against another process of the same OS user. The extension keys grants by the pair and requires user approval for a dedicated tab group.

Operations:

- `group.status` `{origins?: string[]}` -> `{authorized, project, session, groupName?, tabCount?, origins?, requestedOrigins?, nonce?}`. Requested origins are exact origins (max 20), HTTPS except loopback HTTP. The popup displays the exact session and proposal for explicit confirmation; proposals are not grants and a changed proposal replaces the prior proposal/nonce.
- `tabs.list` `{}` -> `{tabs: [{handle, title, url}]}`; only tabs in this session's group and on approved origins. URL has no query or fragment.
- `tab.snapshot` `{handle}` -> `{title, url, text, elements:[{ref,tag,role,name}]}`; masked secret fields and bounded output, but visible page text can include personal data.
- `tab.open` `{url}` -> `{handle}`; open an inactive tab in the session group's window, only on approved origins.
- `tab.navigate` `{handle,url}` -> `{handle}`; only inactive tabs on approved origins, never focus a window.

The popup lists pending and approved sessions. The user selects the exact session, previews its proposed origins, then confirms; Chromium's host permission prompt is invoked directly from that click. A new session creates an inactive extension seed tab in its own group without requiring or moving existing tabs. Later requests can propose additional origins, which require a fresh preview and confirmation. Tabs opened by the bridge are inactive and added to that group. Revocation and browser restart invalidate grants. Tabs in different groups cannot be addressed by the wrong session.

No arbitrary JavaScript, cookies/storage/network access, clicking, typing, screenshots, or uploads in v2 preview. Page contents are untrusted data. The prototype is not an authentication boundary against malicious programs running under the user's account. Windows and Linux installers are not validated releases yet.
