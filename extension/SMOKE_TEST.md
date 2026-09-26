# Extension smoke test

1. Configure the native host manifest with the name `dev.opencode.brave_bridge`, then load this directory as an unpacked extension in a Chromium-based browser. Do not use a static manifest key until the integrator supplies one.
2. Connect a test native host and send a v1 `group.status` request for a test project. Open the popup; it should show that pending project.
3. Select an HTTPS page (or `http://127.0.0.1:<port>`), click **Grant selected tab/group**, and accept Chromium’s origin permission prompt. A tab not already grouped is automatically put in a group. `group.status` should then report that project authorized.
4. Verify `tabs.list` and `tab.snapshot` work only for tabs in the granted group and approved origins. Verify a second project, unapproved origin, and tab in another group are denied. Navigate between approved origins only; `tab.open` should create a background tab in the authorized group.
5. Use **Revoke project grant** and verify requests are denied. Restart the browser and verify grants are revoked. Confirm no operation activates/focuses a tab.

Native host framing is Chromium’s 4-byte little-endian length + UTF-8 JSON; the host speaks newline-delimited JSON to the MCP process. Permission prompts must be tested from the popup’s explicit button clicks.
