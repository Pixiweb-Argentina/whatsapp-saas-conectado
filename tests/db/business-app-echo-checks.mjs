import assert from "node:assert/strict";
export async function runBusinessAppEchoChecks(context) {
  const {db,id,scalar,enqueue,claim,begin,reject,isolated}=context;
  const echo=(patch={})=>({connectionId:id(51),externalAccountId:"fixture-echo-account",wamid:"wamid.human-app",
    recipient:"+15555550101",type:"text",body:"Respuesta humana ficticia",occurredAt:new Date(Date.now()-1000).toISOString(),...patch});
  const persist=(value=echo(),workspace=1,integration=11)=>scalar(db,"select public.persist_business_app_echo($1,$2,$3) result",[id(workspace),id(integration),value]);
  const shared={...context,echo,persist};
  await checkEchoTransitions(shared);await checkEchoIsolation(shared);
}
async function checkEchoTransitions({db,id,scalar,enqueue,claim,begin,reject,isolated,echo,persist}) {
  await isolated("Business App echo records and pauses AI atomically, cancels a leased AI job, preserves window/opt-in and dedups after resume",async()=>{
    await enqueue(db);await claim(db);
    const before=(await db.query("select * from public.conversations where id=$1",[id(31)])).rows[0];
    const value=echo();const first=await persist(value);assert.equal(first.inserted,true);assert.equal(first.aiDisabled,true);
    const after=(await db.query("select * from public.conversations where id=$1",[id(31)])).rows[0];
    assert.equal(after.state,"human_active");assert.equal(after.ai_enabled,false);assert.equal(after.state_revision,1);
    assert.equal(after.window_expires_at.toISOString(),before.window_expires_at.toISOString());assert.equal(after.assigned_to,before.assigned_to);
    assert.equal(await scalar(db,"select state result from public.message_jobs where operation_id=$1",[id(61)]),"cancelled");
    assert.equal(await scalar(db,"select count(*)::int result from public.events where payload->>'trigger'='business_app'"),1);
    await db.query("update public.conversations set state='ai_active',ai_enabled=true where id=$1",[id(31)]);
    assert.equal((await persist(value)).aiDisabled,false);assert.equal(await scalar(db,"select state result from public.conversations where id=$1",[id(31)]),"ai_active");
    assert.equal(await scalar(db,"select count(*)::int result from public.messages where wamid='wamid.human-app'"),1);
    assert.equal(await scalar(db,"select count(*)::int result from public.message_outbox"),0);
  });
  await isolated("failure during human transition rolls back message, echo ledger and cancellation, allowing the same retry",async()=>{
    await enqueue(db);
    await db.exec("create function private.echo_test_abort() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_ABORT' using errcode='23514'; end $$; create trigger echo_abort before insert on public.events for each row execute function private.echo_test_abort()");
    const value=echo();await reject(db,()=>persist(value));
    assert.equal(await scalar(db,"select count(*)::int result from private.business_app_echoes"),0);
    assert.equal(await scalar(db,"select count(*)::int result from public.messages where wamid='wamid.human-app'"),0);
    assert.equal(await scalar(db,"select state result from public.message_jobs where operation_id=$1",[id(61)]),"pending");
    await db.exec("drop trigger echo_abort on public.events");assert.equal((await persist(value)).aiDisabled,true);
  });
  await isolated("a send already permitted remains sending while new human activity cancels future AI work",async()=>{
    await enqueue(db);const job=await claim(db);assert.equal(await begin(db,job),true);await persist();
    assert.equal(await scalar(db,"select state result from public.message_jobs where operation_id=$1",[id(61)]),"sending");
    assert.equal(await scalar(db,"select count(*)::int result from public.message_outbox"),1);
  });
  await isolated("old unseen echo updates history without undoing a newer control change or decreasing last_message_at",async()=>{
    await db.query("update public.conversations set state='human_active',ai_enabled=false,last_message_at=now() where id=$1",[id(31)]);
    await db.query("update public.conversations set state='ai_active',ai_enabled=true where id=$1",[id(31)]);
    const before=await scalar(db,"select last_message_at result from public.conversations where id=$1",[id(31)]);
    assert.equal((await persist()).aiDisabled,false);assert.equal(await scalar(db,"select state result from public.conversations where id=$1",[id(31)]),"ai_active");
    assert.equal((await scalar(db,"select last_message_at result from public.conversations where id=$1",[id(31)])).toISOString(),before.toISOString());
  });
}
async function checkEchoIsolation({db,id,scalar,enqueue,claim,begin,reject,isolated,echo,persist}) {
  await isolated("echo requires exact account, integration, tenant and verified identity; a mutable contact phone does not bind it",async()=>{
    await reject(db,()=>persist(echo(),2),"42501");await reject(db,()=>persist(echo(),1,12),"42501");
    await reject(db,()=>persist(echo({externalAccountId:"other-account"})),"42501");
    await db.query("update public.contact_identities set verified_at=null where connection_id=$1",[id(51)]);
    assert.equal((await persist()).conversationId,null);assert.equal(await scalar(db,"select count(*)::int result from public.messages where wamid='wamid.human-app'"),0);
    assert.equal(await scalar(db,"select state result from public.conversations where id=$1",[id(31)]),"ai_active");
  });
  await isolated("conflicting replay does not change text or pause AI again",async()=>{
    const value=echo();await persist(value);await reject(db,()=>persist({...value,body:"Changed"}));
    assert.equal(await scalar(db,"select body result from public.messages where wamid='wamid.human-app'"),value.body);
  });
  await isolated("revocation, missing identity and closed conversation never grant consent or reopen a conversation",async()=>{
    await db.query("update public.contacts set opt_in=false where id=$1",[id(21)]);
    await db.query("update public.channel_connections set status='revoked',revoked_at=now() where id=$1",[id(51)]);
    assert.equal((await persist()).inserted,false);
    await db.query("update public.channel_connections set status='ready',revoked_at=null where id=$1",[id(51)]);
    assert.equal((await persist(echo({wamid:"missing",recipient:"+15555550999"}))).conversationId,null);
    await db.query("update public.conversations set state='closed',ai_enabled=false where id=$1",[id(31)]);
    assert.equal((await persist(echo({wamid:"closed"}))).aiDisabled,false);
    assert.equal(await scalar(db,"select state result from public.conversations where id=$1",[id(31)]),"closed");
    assert.equal(await scalar(db,"select count(*)::int result from public.contact_identities"),3);
    assert.equal(await scalar(db,"select opt_in result from public.contacts where id=$1",[id(21)]),false);
  });
  await isolated("echo cannot impersonate a job-backed message",async()=>{
    await enqueue(db);const job=await claim(db);await begin(db,job);
    await db.query("update public.messages set wamid='wamid.human-app' where channel_operation_id=$1",[id(61)]);
    await reject(db,()=>persist());assert.equal(await scalar(db,"select count(*)::int result from private.business_app_echoes"),0);
    assert.equal(await scalar(db,"select state result from public.conversations where id=$1",[id(31)]),"ai_active");
  });
  await isolated("browser roles cannot write/read echo records or forge the control timestamp",async()=>{
    for(const role of ["anon","authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);await reject(db,()=>persist(),"42501");
      await reject(db,()=>db.query("select * from private.business_app_echoes"),"42501");await db.exec("RESET ROLE");
    }
    await db.query("update public.conversations set channel_control_changed_at=now()+interval '1 year' where id=$1",[id(31)]);
    assert.equal(await scalar(db,"select channel_control_changed_at result from public.conversations where id=$1",[id(31)]),null);
    await db.exec("SET LOCAL ROLE service_role");assert.equal((await persist()).aiDisabled,true);
  });
}
