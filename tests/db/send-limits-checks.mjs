import assert from "node:assert/strict";

export async function runSendLimitsChecks({db,id,scalar,enqueue,claim,begin,finish,isolated,reject}) {
  async function retry(job, seconds=120) {
    return finish(db,job,{status:"rejected",errorCode:"130429",retryable:true,retryAfterSeconds:seconds});
  }
  async function due(job) {
    await db.query("update public.message_jobs set run_after=clock_timestamp() where operation_id=$1",[job.operation_id]);
    await db.exec("update private.channel_send_budgets set blocked_until='epoch',window_started_at=clock_timestamp()-interval '2 minutes'");
  }
  async function count(table) {return scalar(db,`select count(*)::int result from ${table}`);}
  await isolated("connection budget defers before permit without consuming an attempt",async()=>{
    await enqueue(db); const first=await claim(db); assert.equal(await begin(db,first),true);
    await db.query("update private.channel_send_budgets set limit_per_minute=1 where scope_id=$1",[id(51)]);
    await enqueue(db,{key:"second",request:{...first.request,operationId:id(62)}});
    const next=await claim(db); assert.equal(await begin(db,next),false);
    const row=(await db.query("select * from public.message_jobs where operation_id=$1",[id(62)])).rows[0];
    assert.equal(row.state,"pending"); assert.equal(row.attempts,0); assert.equal(row.last_error_code,"quota_wait");
    assert.equal(await count("public.message_outbox"),1); assert.equal(await claim(db),undefined);
    await due(next);const reclaimed=await claim(db);assert.equal(reclaimed.fence,2);assert.equal(await begin(db,reclaimed),true);
  });
  await isolated("workspace budget independently stops another permit",async()=>{
    await enqueue(db);const job=await claim(db);assert.equal(await begin(db,job),true);
    await db.query("update private.channel_send_budgets set limit_per_minute=1 where scope_id=$1",[id(1)]);
    await enqueue(db,{key:"second",request:{...job.request,operationId:id(62)}});
    assert.equal(await begin(db,await claim(db)),false);assert.equal(await count("public.message_outbox"),1);
  });
  await isolated("failed policy and duplicate/stale permit never consume quota",async()=>{
    await enqueue(db);const job=await claim(db);
    assert.equal(await begin(db,job,{evidence:id(92)}),false);
    assert.equal(await scalar(db,"select sum(used)::int result from private.channel_send_budgets"),0);
    assert.equal(await begin(db,job),true);assert.equal(await begin(db,job),false);
    assert.equal(await scalar(db,"select sum(used)::int result from private.channel_send_budgets"),2);
  });
  await isolated("safe rejection schedules one operation, respects Retry-After and keeps attempt history",async()=>{
    await enqueue(db);const first=await claim(db);assert.equal(await begin(db,first),true);
    assert.equal(await retry(first),true);
    assert.equal(await scalar(db,"select state result from public.message_jobs"),"pending");
    assert.equal(await scalar(db,"select run_after>=clock_timestamp()+interval '119 seconds' result from public.message_jobs"),true);
    assert.equal(await scalar(db,"select state result from public.message_outbox"),"rejected");
    const msg=(await db.query("select id,status,meta from public.messages where channel_operation_id is not null")).rows[0];
    assert.equal(msg.status,"queued");assert.equal(msg.meta.send_outcome,"retry_pending");
    assert.equal(await claim(db),undefined);
    await due(first);const second=await claim(db);assert.equal(second.attempts,2);assert.equal(second.fence,2);
    assert.equal(await begin(db,second),true);assert.equal(await finish(db,second),true);
    assert.equal(await finish(db,first),false);assert.equal(await count("public.message_outbox"),2);
    const rows=(await db.query("select id,status from public.messages where channel_operation_id is not null")).rows;
    assert.deepEqual(rows,[{id:msg.id,status:"sent"}]);
  });
  await isolated("backoff grows exponentially and exhausts after five attempts",async()=>{
    await enqueue(db);
    for(let n=1;n<=5;n++) {
      const job=await claim(db);assert.equal(job.attempts,n);assert.equal(await begin(db,job),true);assert.equal(await retry(job,0),true);
      const row=(await db.query("select state,extract(epoch from run_after-clock_timestamp()) delay from public.message_jobs")).rows[0];
      const base=30*4**(n-1);assert.ok(Number(row.delay)>=base-1&&Number(row.delay)<=base*1.1+1);
      assert.equal(row.state,n===5?"dead_letter":"pending");
      await due(job);
    }
    assert.equal(await claim(db),undefined);assert.equal(await count("public.message_outbox"),5);
    assert.equal(await scalar(db,"select status::text result from public.messages where channel_operation_id is not null"),"failed");
  });
  await isolated("Retry-After beyond queue lifetime parks rather than shortening the wait",async()=>{
    await enqueue(db);const job=await claim(db);await begin(db,job);await retry(job,172800);
    assert.equal(await scalar(db,"select state result from public.message_jobs"),"dead_letter");
    assert.equal(await scalar(db,"select blocked_until>clock_timestamp()+interval '47 hours' result from private.channel_send_budgets where connection_id is not null"),true);
  });
  await isolated("provider cooldown also defers other operations on this connection",async()=>{
    await enqueue(db);const first=await claim(db);await begin(db,first);await retry(first);
    await enqueue(db,{key:"other",request:{...first.request,operationId:id(62)}});
    assert.equal(await begin(db,await claim(db)),false);assert.equal(await count("public.message_outbox"),1);
  });
  await isolated("human takeover cancels waiting retry and preserves the one visible message",async()=>{
    await enqueue(db);const first=await claim(db);await begin(db,first);await retry(first);
    await db.query("update public.conversations set state='human_active',ai_enabled=false where id=$1",[id(31)]);
    assert.equal(await scalar(db,"select state result from public.message_jobs"),"cancelled");
    assert.equal(await scalar(db,"select status::text result from public.messages where channel_operation_id is not null"),"failed");
    assert.equal(await claim(db),undefined);
  });
  await isolated("retries revalidate opt-out, identity, grant and event window",async()=>{
    await enqueue(db);const first=await claim(db);await begin(db,first);await retry(first);await due(first);
    const job=await claim(db);
    for(const change of ["update public.contacts set opt_in=false", "update public.contact_identities set verified_at=null",
      "update public.channel_connections set capabilities='{}'", "update public.inbound_events set historical=true"]) {
      await db.exec("SAVEPOINT policy");await db.exec(change);assert.equal(await begin(db,job),false);
      await db.exec("ROLLBACK TO SAVEPOINT policy; RELEASE SAVEPOINT policy");
    }
    assert.equal(await count("public.message_outbox"),1);
  });
  await isolated("uncertain result and permanent rejection never schedule a retry",async()=>{
    for(const [n,result] of [{status:"unknown",operationId:id(61)}, {status:"rejected",errorCode:"190",retryable:false}].entries()) {
      await enqueue(db,{key:`terminal-${n}`,request:{operationId:id(61+n),channel:"whatsapp",action:"text",recipient:"+15555550101",body:"fixture"}});
      const job=await claim(db);await begin(db,job);await finish(db,job,result);
    }
    await db.exec("update public.message_jobs set run_after='epoch'");assert.equal(await claim(db),undefined);
  });
  await isolated("a contradictory receipt parks a retry as uncertain before a new permit",async()=>{
    await enqueue(db);const first=await claim(db);await begin(db,first);await retry(first);await due(first);
    await db.query(`insert into private.channel_delivery_receipts(workspace_id,connection_id,provider_event_id,provider,
      external_account_id,status,wamid,external_operation_id,occurred_at)
      values($1,$2,'contradiction','ycloud','+15555550100','sent','wamid.contradiction',$3,now())`,[id(1),id(51),first.operation_id]);
    assert.equal(await begin(db,await claim(db)),false);
    assert.equal(await scalar(db,"select state result from public.message_jobs"),"unknown");
    assert.equal(await scalar(db,"select meta->>'send_outcome' result from public.messages where channel_operation_id is not null"),"unknown");
    assert.equal(await count("public.message_outbox"),1);assert.equal(await claim(db),undefined);
  });
  await isolated("invalid retry hints roll back finalization",async()=>{
    await enqueue(db);const job=await claim(db);await begin(db,job);
    for(const retryAfterSeconds of [-1,1.5,"120",2147483648]) await reject(db,()=>finish(db,job,
      {status:"rejected",errorCode:"130429",retryable:true,retryAfterSeconds}));
    assert.equal(await scalar(db,"select state result from public.message_jobs"),"sending");
  });
  await isolated("budget tables and new permit RPC remain inaccessible to clients",async()=>{
    await enqueue(db);const job=await claim(db);
    for(const role of ["anon","authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await reject(db,()=>db.query("select * from private.channel_send_budgets"),"42501");
      await reject(db,()=>db.query("select public.begin_channel_send_status($1,$2,$3,$4,$5,now()+interval '1 minute')",
        [job.workspace_id,job.operation_id,job.lease_owner,job.fence,job.event_id]),"42501");
      await db.exec("RESET ROLE");
    }
  });
}
