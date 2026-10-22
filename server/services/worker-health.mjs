export async function workerHeartbeat(store,status='idle') {
  await store.db.prepare("INSERT INTO worker_health(id,status,heartbeat_at) VALUES('local',?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,heartbeat_at=excluded.heartbeat_at").run(status,Date.now());
}
export async function workerStatus(store) {
  const row=await store.db.prepare("SELECT status,heartbeat_at FROM worker_health WHERE id='local'").get();
  const alive=!!row && row.status!=='stopped' && Date.now()-row.heartbeat_at<45000;
  return {status:alive ? row.status : 'offline',heartbeatAt:row?.heartbeat_at || null};
}
