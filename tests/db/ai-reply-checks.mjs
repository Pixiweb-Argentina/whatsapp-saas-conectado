import assert from "node:assert/strict";

function context(deps) {
  const {db,persist,scalar,id}=deps;
  async function aiBatch(meta = {}) {
    await persist(db);
    await db.query(`insert into public.message_batches(id,workspace_id,conversation_id,status,meta)
      values($1,$2,$3,'processing',$4)`,[id(991),id(1),id(31),meta]);
    await db.query(`insert into public.messages(workspace_id,conversation_id,batch_id,direction,type,body,wamid)
      values($1,$2,$3,'in','text','Synthetic AI input','message-1')`,[id(1),id(31),id(991)]);
  }
  const aiPrepare = (mode = "queue", workspace = 1) => scalar(db,
    "select public.prepare_ai_channel_reply($1,$2,$3) result",[id(workspace),id(991),mode]);
  const aiEnqueue = (body = "Synthetic AI reply", workspace = 1) => scalar(db,
    "select public.enqueue_ai_channel_reply($1,$2,$3) result",[id(workspace),id(991),body]);

  return {...deps,aiBatch,aiPrepare,aiEnqueue};
}

async function checkPinnedContext(ctx) {
  const {db,id,scalar,persist,reject,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("AI pins exact batch event/account/revision and recovers immutable queue mode/text",async () => {
    await aiBatch();
    const prep=await aiPrepare(); assert.equal(prep.eligible,true); assert.equal(prep.reply,null);
    assert.equal(await scalar(db,"select meta->'isolated' result from public.message_batches where id=$1",[id(991)]),true);
    const captured=(await db.query("select * from private.ai_reply_preparations where batch_id=$1",[id(991)])).rows[0];
    assert.equal(captured.expected_revision,0); assert.equal(captured.event_id,await persist(db));
    assert.equal(captured.connection_id,id(51));
    assert.equal((await aiPrepare("legacy")).mode,"queue");
    const first=await aiEnqueue(); const retry=await aiEnqueue();
    assert.equal(first.state,"pending"); assert.equal(retry.duplicate,true); assert.equal(first.operationId,id(991));
    assert.equal((await aiPrepare()).reply,"Synthetic AI reply");
    assert.equal((await db.query("select count(*) n from public.message_jobs")).rows[0].n,1);
    assert.equal((await db.query("select count(*) n from public.message_outbox")).rows[0].n,0);
    await reject(db,()=>aiEnqueue("changed"));
  });
}

async function checkLegacyMode(ctx) {
  const {db,id,reject,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("legacy attempts and already checkpointed batches cannot switch to queue",async () => {
    await aiBatch(); assert.equal((await aiPrepare("legacy")).mode,"legacy");
    assert.equal((await aiPrepare("queue")).mode,"legacy");
    await reject(db,()=>aiEnqueue());
    for (const meta of [{retry_count:1},{pending_reply:"old"},{write_tools_ran:[]},{llm_reservation_id:"old"},{jev_verdict:{}},{pending_handoff:"old"}]) {
      await db.query("delete from private.ai_reply_preparations where batch_id=$1",[id(991)]);
      await db.query("update public.message_batches set meta=$1 where id=$2",[meta,id(991)]);
      assert.equal((await aiPrepare()).mode,"legacy");
    }
  });
}

async function checkEvidence(ctx) {
  const {db,id,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("unlinked, historical and reaction evidence never authorizes AI generation",async () => {
    await aiBatch();
    for (const change of [
      "update public.messages set batch_id=null where batch_id=$1",
      "update public.inbound_events set historical=true",
      "update public.inbound_events set envelope=jsonb_set(envelope,'{content,rawType}','\"reaction\"')",
    ]) {
      await db.exec("SAVEPOINT no_evidence");
      try {
        await db.query(change,change.includes("$1")?[id(991)]:[]);
        assert.equal((await aiPrepare()).eligible,false);
        assert.equal((await aiEnqueue()).queued,false);
        assert.equal((await aiPrepare("legacy")).mode,"queue");
      } finally { await db.exec("ROLLBACK TO no_evidence; RELEASE no_evidence"); }
    }
  });
}

async function checkHumanResume(ctx) {
  const {db,id,reject,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("human takeover then AI resume invalidates old generation without losing text checkpoint",async () => {
    await aiBatch(); await aiPrepare();
    await db.query("update public.conversations set state='human_active',ai_enabled=false where id=$1",[id(31)]);
    await db.query("update public.conversations set state='ai_active',ai_enabled=true where id=$1",[id(31)]);
    assert.equal((await aiPrepare()).eligible,false);
    assert.equal((await aiEnqueue()).queued,false);
    const recovered=await aiPrepare("legacy");
    assert.equal(recovered.mode,"queue"); assert.equal(recovered.reply,"Synthetic AI reply");
    await reject(db,()=>aiEnqueue("regenerated text"));
    assert.equal((await db.query("select count(*) n from public.message_jobs")).rows[0].n,0);
  });
}

async function checkRevalidation(ctx) {
  const {db,id,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("grant, identity, suppression, expiry and batch cancellation revalidate before AI enqueue",async () => {
    await aiBatch(); await aiPrepare();
    for (const change of [
      "update public.channel_connections set capabilities='{}'",
      "update public.channel_connections set status='revoked',revoked_at=now()",
      "update public.contact_identities set verified_at=null",
      "update public.contacts set opt_in=false",
      `insert into public.contact_opt_outs(workspace_id,phone_key,source) values('${id(1)}','15555550101','keyword')`,
      "update public.inbound_events set envelope=jsonb_set(envelope,'{occurredAt}',to_jsonb((now()-interval '25 hours')::text))",
      "update public.message_batches set status='cancelled'",
    ]) {
      await db.exec("SAVEPOINT revalidate");
      try {
        await db.exec(change); assert.equal((await aiEnqueue()).queued,false);
        assert.equal((await aiPrepare()).reply,"Synthetic AI reply");
      } finally { await db.exec("ROLLBACK TO revalidate; RELEASE revalidate"); }
    }
  });
}

async function checkUnknownRecovery(ctx) {
  const {db,id,claim,begin,finish,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("AI duplicate reconciles unknown even after control changes, without another job/permit",async () => {
    await aiBatch(); await aiPrepare(); await aiEnqueue();
    const job=await claim(db); await db.exec("SET ROLE service_role");
    assert.equal(await begin(db,job),true);
    assert.equal(await finish(db,job,{status:"unknown",operationId:id(991)}),true);
    await db.exec("RESET ROLE");
    await db.query("update public.conversations set state='human_active',ai_enabled=false where id=$1",[id(31)]);
    const retry=await aiEnqueue(); assert.equal(retry.duplicate,true); assert.equal(retry.state,"unknown");
    assert.equal((await aiPrepare("legacy")).state,"unknown");
    assert.equal((await db.query("select count(*) n from public.message_outbox")).rows[0].n,1);
    assert.equal(await claim(db),undefined);
  });
}

async function checkServiceScope(ctx) {
  const {db,reject,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("AI public RPCs and private snapshots are service-only and cross-tenant scopes fail",async () => {
    await aiBatch(); await reject(db,()=>aiPrepare("queue",2),"42501");
    await aiPrepare(); await reject(db,()=>aiEnqueue("hola",2),"42501");
    for (const role of ["anon","authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await reject(db,()=>aiPrepare(),"42501");
      await reject(db,()=>aiEnqueue(),"42501");
      await reject(db,()=>db.query("select * from private.ai_reply_preparations"),"42501");
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE service_role");
    assert.equal((await aiPrepare()).eligible,true); assert.equal((await aiEnqueue()).queued,true);
  });
}

async function checkInput(ctx) {
  const {db,id,reject,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("AI needs preparation, valid text and a processing batch; metadata cannot overwrite pinned context",async () => {
    await aiBatch(); await reject(db,()=>aiEnqueue());
    await reject(db,()=>aiPrepare(null),"22023");
    await aiPrepare();
    await db.query("update public.message_batches set meta=$1 where id=$2",[{ai_mode:"legacy",ai_revision:99,pending_reply:"forged"},id(991)]);
    assert.equal((await aiPrepare("legacy")).mode,"queue");
    for (const body of [null," ","x".repeat(4097)]) await reject(db,()=>aiEnqueue(body),"22023");
    assert.equal((await aiEnqueue()).queued,true);
  });
}

export async function runAiReplyDatabaseChecks(deps) {
  const ctx=context(deps);
  for (const run of [checkPinnedContext,checkLegacyMode,checkEvidence,checkHumanResume,checkRevalidation,checkUnknownRecovery,
    checkServiceScope,checkInput,checkPrivateCheckpoint,checkQuietHandoff,checkDeferredHandoff,checkHandoffScope]) await run(ctx);
}

async function checkPrivateCheckpoint(ctx) {
  const {db,id,scalar,reject,isolated,aiBatch,aiPrepare}=ctx;
  await isolated("private AI text checkpoint is immutable and independent of mutable batch metadata",async()=>{
    await aiBatch(); await aiPrepare();
    const checkpoint=(text)=>scalar(db,"select public.checkpoint_ai_channel_reply($1,$2,$3) result",[id(1),id(991),text]);
    assert.equal(await checkpoint("private original"),true); assert.equal(await checkpoint("private original"),true);
    await reject(db,()=>checkpoint("changed"));
    await db.query("update public.message_batches set meta=$1 where id=$2",[{pending_reply:"injected"},id(991)]);
    assert.equal((await aiPrepare()).reply,"private original");
    assert.equal((await db.query("select count(*) n from public.message_jobs")).rows[0].n,0);
  });
}
async function checkQuietHandoff(ctx) {
  const {db,id,scalar,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("AI handoff updates control/audit/internal note atomically and emits no outbound permit",async()=>{
    await aiBatch(); await aiPrepare();
    const handoff=()=>scalar(db,"select public.handoff_ai_channel_reply($1,$2,'keyword') result",[id(1),id(991)]);
    assert.deepEqual(await handoff(),{settled:true,changed:true});
    assert.deepEqual(await handoff(),{settled:true,changed:false});
    assert.equal((await aiEnqueue()).queued,false);
    assert.equal(await scalar(db,"select state::text result from public.conversations where id=$1",[id(31)]),"handoff_pending");
    assert.equal(await scalar(db,"select count(*)::int result from public.events where type='state_change'"),1);
    assert.equal(await scalar(db,"select count(*)::int result from public.messages where meta->>'reason'='ai_queue_handoff'"),1);
    assert.equal(await scalar(db,"select count(*)::int result from public.message_outbox"),0);
  });
}
async function checkDeferredHandoff(ctx) {
  const {db,id,scalar,claim,begin,finish,isolated,aiBatch,aiPrepare,aiEnqueue}=ctx;
  await isolated("handoff defers pending/in-flight AI then settles unknown without an ACK or second job",async()=>{
    await aiBatch(); await aiPrepare(); await aiEnqueue();
    const handoff=()=>scalar(db,"select public.handoff_ai_channel_reply($1,$2,'tool') result",[id(1),id(991)]);
    assert.equal((await handoff()).settled,false);
    const job=await claim(db); await db.exec("SET ROLE service_role"); assert.equal(await begin(db,job),true);
    assert.equal((await handoff()).settled,false);
    assert.equal(await finish(db,job,{status:"unknown",operationId:id(991)}),true);
    assert.equal((await handoff()).changed,true); await db.exec("RESET ROLE");
    assert.equal((await aiEnqueue()).state,"unknown");
    assert.equal(await scalar(db,"select count(*)::int result from public.message_outbox"),1);
    assert.equal(await scalar(db,"select count(*)::int result from public.message_jobs"),1);
  });
}
async function checkHandoffScope(ctx) {
  const {db,id,scalar,reject,isolated,aiBatch,aiPrepare}=ctx;
  await isolated("checkpoint/handoff are service-only and stale revision cannot override human/resume",async()=>{
    await aiBatch(); await aiPrepare();
    for (const role of ["anon","authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await reject(db,()=>db.query("select public.checkpoint_ai_channel_reply($1,$2,'x')",[id(1),id(991)]),"42501");
      await reject(db,()=>db.query("select public.handoff_ai_channel_reply($1,$2,'keyword')",[id(1),id(991)]),"42501");
      await db.exec("RESET ROLE");
    }
    await reject(db,()=>db.query("select public.handoff_ai_channel_reply($1,$2,'keyword')",[id(2),id(991)]),"42501");
    await db.query("update public.conversations set state='human_active',ai_enabled=false where id=$1",[id(31)]);
    await db.query("update public.conversations set state='ai_active',ai_enabled=true where id=$1",[id(31)]);
    assert.deepEqual(await scalar(db,"select public.handoff_ai_channel_reply($1,$2,'keyword') result",[id(1),id(991)]),{settled:true,changed:false});
    assert.equal(await scalar(db,"select state::text result from public.conversations where id=$1",[id(31)]),"ai_active");
  });
}
