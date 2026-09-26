# Bridge protocol v1

The extension initiates `chrome.runtime.connectNative('dev.opencode.brave_bridge')`.
Chromium native messaging uses a four-byte little-endian length followed by a UTF-8 JSON message. The host exchanges newline-delimited JSON with the local MCP process over a Unix socket on macOS/Linux and a named pipe on Windows. No TCP listener.

Requests from MCP to extension: `{ "v": 1, "id": "opaque", "op": "group.status", "params": { ... } }`.
Responses: `{ "v": 1, "id": "opaque", "ok": true, "result": { ... } }` or `{ "v": 1, "id": "opaque", "ok": false, "error": { "code": "E_...", "message": "..." } }`.

Operations (v1):

- `group.status` `{project: string}` -> `{authorized: boolean, groupName?: string, origins?: string[]}`
- `tabs.list` `{project: string}` -> `{tabs: [{handle: number, title: string, url: string}]}`
- `tab.snapshot` `{project: string, handle: number}` -> `{title: string, url: string, text: string, elements: [{ref: string, tag: string, role: string, name: string}]}`. Mask secret fields, truncate output.
- `tab.open` `{project: string, url: string}` -> `{handle: number}`; open an inactive tab inside an authorized group; only previously approved origins.
- `tab.navigate` `{project: string, handle: number, url: string}` -> `{handle: number}`; same-origin or approved origins only, never activate.

Every operation is authorized by the extension against an explicit user grant for `project` and the tab's *current* group and origin. No arbitrary JavaScript, cookie/storage/network access, clicking, typing, screenshots, or uploads in v1. A group grant is made by the user in the extension popup for the currently selected tab, and is revoked on browser restart or by the popup. The extension must never activate a tab or focus a window. The MCP server derives `project` from its working directory, never from tool arguments.

Errors are ordinary response frames, never instructions. Page contents are untrusted data.
