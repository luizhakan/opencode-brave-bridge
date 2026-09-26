const projectNode = document.querySelector("#project");
const statusNode = document.querySelector("#status");
const grantButton = document.querySelector("#grant");
const addButton = document.querySelector("#add-origin");
const revokeButton = document.querySelector("#revoke");
let project = "";

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "get-state" });
  project = state?.project || "";
  projectNode.textContent = project ? `Pending project: ${project}` : "No pending project. Make an OpenCode bridge request first.";
  grantButton.disabled = !project;
  addButton.disabled = !project;
  revokeButton.disabled = !project || !state.granted;
}
async function grant(origin) {
  statusNode.textContent = "";
  const result = await chrome.runtime.sendMessage({ type: "grant", project, origin });
  statusNode.textContent = result?.error || `Granted ${result.origin} to the selected tab group.`;
  await refresh();
}
grantButton.addEventListener("click", () => grant());
addButton.addEventListener("click", () => {
  const origin = document.querySelector("#origin").value.trim();
  if (!origin) { statusNode.textContent = "Enter an origin first."; return; }
  grant(origin);
});
revokeButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "revoke", project });
  statusNode.textContent = "Project grant revoked.";
  await refresh();
});
refresh();
