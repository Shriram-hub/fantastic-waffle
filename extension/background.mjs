export function combineResults(results) {
  const reports=results.map(r => r.result).filter(Boolean);
  if(!reports.length)return null;
  return {status:reports.some(r=>r.status === 'blocked') ? 'blocked' : 'needs-review',filled:reports.reduce((sum,r)=>sum+(r.filled||0),0),missing:[...new Set(reports.flatMap(r=>r.missing || []))].slice(0,50)};
}
import { buildAnswers, fillApplication } from "./autofill.mjs";
async function request(path, body) {
  const { base, token } = await chrome.storage.session.get(["base", "token"]);
  if (!base || !token) throw Error("Pair the extension first.");
  const response = await fetch(`${base}/api/extension/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Orbit request failed.");
  return data;
}
async function next() {
  const { task } = await request("next");
  if (!task)
    return {
      message:
        "No queued applications. Add jobs to the browser queue in Orbit.",
    };
  const tab = await chrome.tabs.create({ url: task.url, active: true });
  await chrome.storage.session.set({ currentTask: { task, tabId: tab.id } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(
        Error("The page is still loading. Fill it manually or queue it again."),
      );
    }, 25000);
    const listener = (id, change) => {
      if (id === tab.id && change.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tab.id).then((t) => {
      if (t.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
  const resume = task.resume ? await request("resume") : null;
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: fillApplication,
    args: [buildAnswers(task.profile, task.qa), resume],
  });
  const report = combineResults(results) || {
    status: "needs-review",
    missing: ["Could not inspect this form."],
  };
  await request("report", { taskId: task.id, ...report });
  await chrome.storage.session.set({
    lastResult: { ...report, company: task.company, role: task.role },
  });
  return {
    message:
      report.status === "blocked"
        ? "Verification needs your interaction."
        : "Fields filled where supported. Review and submit in the open tab.",
  };
}
async function refill() {
  const { currentTask } = await chrome.storage.session.get("currentTask");
  if (!currentTask) throw Error("Open a queued application first.");
  const { task, tabId } = currentTask,
    tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith(task.url.split("?")[0]))
    throw Error(
      "Return to the original application page before filling again.",
    );
  const resume = task.resume ? await request("resume") : null,
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: fillApplication,
      args: [buildAnswers(task.profile, task.qa), resume],
    });
  const report = combineResults(results) || {
    status: "needs-review",
    missing: ["Form is not available."],
  };
  await request("report", { taskId: task.id, ...report });
  await chrome.storage.session.set({
    lastResult: { ...report, company: task.company, role: task.role },
  });
  return {
    message: "Fields updated where supported. Review and submit yourself.",
  };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!["next", "refill"].includes(message.type)) return;
  (message.type === "refill" ? refill() : next())
    .then(respond)
    .catch((error) => respond({ error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (!['submission-attempt','application-confirmation'].includes(message.type)) return;
  (async () => {
    const {currentTask}=await chrome.storage.session.get('currentTask');
    if(!currentTask || sender.tab?.id !== currentTask.tabId) throw Error('This tab has no active Orbit task.');
    const source=new URL(sender.url),target=new URL(currentTask.task.url);
    if(source.hostname !== target.hostname) throw Error('Confirmation origin does not match this task.');
    if(message.type === 'submission-attempt') {
      await request('submission',{taskId:currentTask.task.id,status:'submission-pending',url:source.href});
      await chrome.storage.session.set({submissionAttempt:{taskId:currentTask.task.id,at:Date.now()}});
    } else {
      const {submissionAttempt}=await chrome.storage.session.get('submissionAttempt');
      if(submissionAttempt?.taskId !== currentTask.task.id || Date.now()-submissionAttempt.at > 15*60000) return;
      await request('submission',{taskId:currentTask.task.id,status:'confirmed',url:source.href,evidence:message.evidence});
      await chrome.storage.session.set({lastResult:{status:'confirmed',company:currentTask.task.company,role:currentTask.task.role}});
      await chrome.storage.session.remove(['submissionAttempt','currentTask']);
    }
    return {ok:true};
  })().then(respond).catch(error=>respond({error:error.message}));
  return true;
});
