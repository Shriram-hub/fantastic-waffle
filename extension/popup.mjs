const form = document.querySelector("#pair"),
  status = document.querySelector("#status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(form),
      u = new URL(data.get("base"));
    if (
      u.username ||
      u.password ||
      (u.protocol !== "https:" &&
        !["127.0.0.1", "localhost"].includes(u.hostname))
    )
      throw Error("Use HTTPS or a loopback Orbit address.");
    if (u.protocol === "https:") {
      const granted = await chrome.permissions.request({
        origins: [`${u.origin}/*`],
      });
      if (!granted)
        throw Error("Access to this Orbit address was not granted.");
    }
    await chrome.storage.session.set({
      base: u.origin,
      token: data.get("token"),
    });
    status.textContent =
      "Paired. Add jobs to the queue, then open the next one.";
  } catch (error) {
    status.textContent = error.message;
  }
});
document.querySelector("#next").addEventListener("click", async (event) => {
  event.target.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "next" });
    status.textContent = result.error || result.message;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    event.target.disabled = false;
  }
});
document.querySelector("#forget").addEventListener("click", async () => {
  await chrome.storage.session.clear();
  form.elements.token.value = "";
  status.textContent = "Connection forgotten.";
});
const saved = await chrome.storage.session.get(["base", "lastResult"]);
if (saved.base) form.elements.base.value = saved.base;
if (saved.lastResult)
  document.querySelector("#result").textContent =
    `${saved.lastResult.company}: ${saved.lastResult.status}. ${saved.lastResult.missing.join(" ")}`;

document.querySelector("#refill").addEventListener("click", async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: "refill" });
    status.textContent = result.error || result.message;
  } catch (error) {
    status.textContent = error.message;
  }
});
