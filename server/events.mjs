// One database watcher serves all authenticated SSE subscribers, including tasks
// completed by a separate worker process. No provider payloads/tokens are emitted.
export function taskEvents(queue) {
  const clients = new Set();
  let timer, running = false, previous = new Map();
  const send = (res, event, value) => {
    if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  };
  async function poll() {
    if (running || !clients.size) return;
    running = true;
    try {
      const rows = await queue.list(), next = new Map();
      for (const task of rows) {
        const signature = `${task.status}:${task.updated_at}`;
        next.set(task.id, signature);
        if (previous.get(task.id) !== signature) for (const res of clients) send(res, 'task', {id:task.id,kind:task.kind,status:task.status,updatedAt:task.updated_at});
      }
      previous = next;
    } catch { for (const res of clients) send(res, 'unavailable', {message:'Activity connection is reconnecting.'}); }
    finally { running = false; }
  }
  return {
    async connect(req,res) {
      if (clients.size >= 16) { res.writeHead(429);res.end('Too many activity connections.');return; }
      if (!clients.size) previous = new Map((await queue.list()).map(t => [t.id, `${t.status}:${t.updated_at}`]));
      res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write('retry: 3000\n\n');
      clients.add(res);send(res,'ready',{connected:true});
      if (!timer) {timer=setInterval(poll,1500);timer.unref();}
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); },25000);
      heartbeat.unref();
      res.once('close',() => {clearInterval(heartbeat);clients.delete(res);if (!clients.size) {clearInterval(timer);timer=null;previous.clear();}});
    },
    close() { clearInterval(timer);for(const res of clients)res.end();clients.clear(); },
  };
}
