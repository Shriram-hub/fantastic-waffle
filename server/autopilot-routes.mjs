import { timingSafeEqual } from "node:crypto";
import {scheduleDiscovery} from './services/discovery.mjs';
import {setupReadiness} from './discovery-routes.mjs';
import {scheduleMailboxSync} from './services/inbox.mjs';
import { fail } from "./domain.mjs";
import { autopilotStatus, savePolicy, getPolicy, ensureSearchMatrix, scheduleAutopilot, reviewAutopilot, approveReview, retryHeldLookups } from "./services/autopilot.mjs";

export function autopilotRoutes(store,queue,config,fetcher) {
  return {
    async publicRoute(req,res,url,{json}) {
      if(url.pathname!=="/api/internal/autopilot/tick") return false;
      if(req.method!=="POST") fail("Method not allowed.",405);
      const actual=Buffer.from(String(req.headers["x-orbit-scheduler"] || "")),expected=Buffer.from(config.AUTOPILOT_CRON_SECRET || "");
      if(!expected.length || expected.length!==actual.length || !timingSafeEqual(actual,expected)) fail("Invalid scheduler credential.",401);
      const task=await scheduleAutopilot(store,queue,config);
      const discovery=await scheduleDiscovery(store,queue,config);
      const inboxes=await scheduleMailboxSync(store,queue);
      // A tick wakes the embedded worker for real due tasks, even while discovery is paused.
      json(res,202,{scheduled:!!task || !!discovery || !!inboxes,version:"0.5.0",storage:store.kind || "sqlite",setup:setupReadiness(store,config)});return true;
    },
    async handle(req,res,url,{json,bodyJSON}) {
      const path=url.pathname;
      if(!path.startsWith("/api/autopilot")) return false;
      if(req.method==="GET" && path==="/api/autopilot") {json(res,200,await autopilotStatus(store,config));return true;}
      if(req.method==="GET" && path==="/api/autopilot/review") {json(res,200,await reviewAutopilot(store));return true;}
      if(!["PUT","POST"].includes(req.method)) fail("Method not allowed.",405);
      const data=await bodyJSON(req);
      if(path==="/api/autopilot" && req.method==="PUT") {
        const policy=await savePolicy(data,store,config);
        await ensureSearchMatrix(store,config,fetcher);
        if(policy.enabled) {
          await store.db.prepare("UPDATE autopilot_schedule SET next_run=0 WHERE id='local'").run();
          await scheduleAutopilot(store,queue,config);
        }
        json(res,200,await autopilotStatus(store,config));return true;
      }
      if(path==='/api/autopilot/run' && req.method==='POST') {
        const discovery=await scheduleDiscovery(store,queue,config,true);
        const outreach=await scheduleAutopilot(store,queue,config);
        json(res,202,{taskId:discovery?.id || outreach?.id || null,queued:!!discovery || !!outreach});return true;
      }
      if(path==="/api/autopilot/sweep" && req.method==="POST") {
        const policy=await getPolicy(store);
        if(!policy.enabled) fail("Enable Autopilot first.",409);
        const active=await store.db.prepare("SELECT id FROM tasks WHERE kind='JOB_DISCOVERY_SWEEP' AND status IN ('queued','running')").get();
        if(active) {json(res,202,{taskId:active.id,existing:true});return true;}
        // Refresh controls do not bypass provider caches or the durable schedule.
        const task=await scheduleAutopilot(store,queue,config);
        json(res,202,{taskId:task?.id || null,cached:!task});return true;
      }
      if(path==="/api/autopilot/approve" && req.method==="POST") {json(res,202,await approveReview(data,store,queue,config));return true;}
      if(path==="/api/autopilot/retry-lookups" && req.method==="POST") {json(res,202,await retryHeldLookups(data,store,queue));return true;}
      fail("Unknown Autopilot action.",404);
    },
  };
}
