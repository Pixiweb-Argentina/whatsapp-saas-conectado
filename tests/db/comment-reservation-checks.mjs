import assert from "node:assert/strict";

function helpers({db,id,scalar}) {
  async function fixture(channel="instagram", connection=55) {
    await db.query(`insert into public.channel_connections(id,workspace_id,channel,provider,external_account_id,status,capabilities)
      values ($1::uuid,$2::uuid,$3,'meta',$4,'ready',jsonb_build_object('version',1,'grants',jsonb_build_array(
        jsonb_build_object('workspaceId',($2::uuid)::text,'connectionId',($1::uuid)::text,'capability','private_reply',
          'verifiedAt',now()-interval '1 minute','validUntil',now()+interval '1 hour','evidenceRef','synthetic-account-proof'),
        jsonb_build_object('workspaceId',($2::uuid)::text,'connectionId',($1::uuid)::text,'capability','public_reply',
          'verifiedAt',now()-interval '1 minute','validUntil',now()+interval '1 hour','evidenceRef','synthetic-account-proof'))))`,
      [id(connection),id(1),channel,"synthetic-meta-"+connection]);
    await db.query(`insert into public.contact_identities(workspace_id,contact_id,connection_id,external_user_id,verified_at)
      values ($1,$2,$3,'meta-actor',now()-interval '1 minute')`,[id(1),id(23),id(connection)]);
    const occurredAt=new Date(Date.now()-60000).toISOString();
    const envelope={schemaVersion:1,workspaceId:id(1),connectionId:id(connection),channel,provider:"meta",
      providerEventId:"comment-fixture",kind:"comment",externalActorId:"meta-actor",externalCommentId:"opaque-comment",
      occurredAt,receivedAt:occurredAt,content:{type:"text",text:"hola",rawType:"comment"},mediaRefs:[],
      sourceContext:{channel,sourceType:"comment"}};
    const event=await scalar(db,"select public.persist_channel_event($1,false) result",[envelope]);
    await db.query(`insert into private.channel_comment_evidence(workspace_id,connection_id,event_id,external_comment_id,
      external_account_id,external_actor_id,source_kind,occurred_at,valid_until,verification_ref)
      values ($1,$2,$3,'opaque-comment',$4,'meta-actor','post',$5,now()+interval '1 hour','synthetic-only')`,
      [id(1),id(connection),event,"synthetic-meta-"+connection,occurredAt]);
    const job={connection:id(connection),conversation:null,revision:null,event,actor:"automation",key:"comment-rule-1",
      request:{operationId:id(61),channel,recipient:"meta-actor",action:"private_reply",commentId:"opaque-comment",body:"Tu guía"}};
    return {job,event,envelope};
  }
  async function evidence(f,patch={}) {
    const args={workspace:id(1),connection:f.job.connection,event:f.event,recipient:"meta-actor",...patch};
    return scalar(db,"select public.read_channel_comment_evidence($1,$2,$3,$4) result",Object.values(args));
  }
  async function count(table){return scalar(db,"select count(*)::int result from "+table);}
  return {fixture,evidence,count};
}

async function runOwnershipChecks(context) {
  const {db,id,scalar,enqueue,claim,begin,isolated,reject}=context;
  const {fixture,evidence,count}=helpers(context);
  for (const channel of ["instagram","messenger"]) {
    await isolated(channel+" comment has one durable owner; public reply stays independent",async()=>{
      const f=await fixture(channel);const before=await evidence(f);
      assert.equal(before.id,f.event);assert.equal(before.externalCommentId,"opaque-comment");assert.equal(before.privateReply,"available");
      assert.equal(await enqueue(db,f.job),id(61));
      assert.equal(await enqueue(db,{...f.job,request:{...f.job.request,operationId:id(62)}}),id(61));
      await reject(db,()=>enqueue(db,{...f.job,key:"competing-rule",request:{...f.job.request,operationId:id(62)}}));
      assert.equal(await count("private.private_reply_claims"),1);assert.equal(await count("public.message_jobs"),1);
      assert.equal((await evidence(f)).reservedOperationId,id(61));
      await enqueue(db,{...f.job,key:"public-rule",request:{...f.job.request,operationId:id(63),action:"public_reply"}});
      assert.equal(await count("private.private_reply_claims"),1);assert.equal(await count("public.message_jobs"),2);
    });
  }
  await isolated("reservation rollback does not strand a claim or queue a losing rule",async()=>{
    const f=await fixture();await db.exec("SAVEPOINT producer");await enqueue(db,f.job);
    await db.exec("ROLLBACK TO SAVEPOINT producer; RELEASE SAVEPOINT producer");
    assert.equal(await count("private.private_reply_claims"),0);assert.equal(await count("public.message_jobs"),0);
    await enqueue(db,f.job);assert.equal(await count("private.private_reply_claims"),1);
  });
  await isolated("same opaque comment ID on different accounts stays separate",async()=>{
    const a=await fixture(),b=await fixture("instagram",56);
    await enqueue(db,a.job);await enqueue(db,{...b.job,request:{...b.job.request,operationId:id(62)}});
    assert.equal(await count("private.private_reply_claims"),2);
  });

}

async function runEligibilityChecks(context) {
  const {db,id,scalar,enqueue,claim,begin,isolated,reject}=context;
  const {fixture,evidence,count}=helpers(context);
  const invalid=[
    "delete from private.channel_comment_evidence",
    "update private.channel_comment_evidence set revoked_at=now()",
    "update private.channel_comment_evidence set valid_until=now()-interval '1 second'",
    "update private.channel_comment_evidence set verified_at=now()+interval '1 hour'",
    "update private.channel_comment_evidence set external_account_id='another-account'",
    "update public.inbound_events set historical=true",
    "update public.inbound_events set envelope=jsonb_set(envelope,'{externalActorId}','\"other\"')",
    "update public.contacts set opt_in=false where id='"+id(23)+"'",
    "update public.contact_identities set verified_at=null where connection_id='"+id(55)+"'",
    "update public.channel_connections set status='needs_permissions' where id='"+id(55)+"'",
  ];
  for(const [index,sql] of invalid.entries()) await isolated("invalid comment proof/recipient fails closed "+index,async()=>{
    const f=await fixture();await db.exec(sql);assert.equal(await evidence(f),null);
    await reject(db,()=>enqueue(db,f.job));assert.equal(await count("private.private_reply_claims"),0);
  });
  await isolated("capability absence cannot be bypassed with a raw enqueue RPC",async()=>{
    const f=await fixture();await db.exec("update public.channel_connections set capabilities='{}' where provider='meta'");
    await reject(db,()=>enqueue(db,f.job));assert.equal(await count("public.message_jobs"),0);
  });
  await isolated("foreign tenant/event/actor cannot read a comment proof",async()=>{
    const f=await fixture();for(const patch of [{workspace:id(2)},{connection:id(51)},{event:id(91)},{recipient:"other"}])
      assert.equal(await evidence(f,patch),null);
  });
  await isolated("browser roles cannot read or write proofs/claims or call their reader",async()=>{
    const f=await fixture();for(const role of ["anon","authenticated"]) {
      await db.exec("SET ROLE "+role);
      for(const table of ["channel_comment_evidence","private_reply_claims"])
        await reject(db,()=>db.exec("select * from private."+table),"42501");
      await reject(db,()=>evidence(f),"42501");await db.exec("RESET ROLE");
    }
  });

}

async function runSafetyChecks(context) {
  const {db,id,scalar,enqueue,claim,begin,isolated,reject}=context;
  const {fixture,evidence,count}=helpers(context);
  await isolated("Meta reservation cannot open a send permit; cancellation never frees it",async()=>{
    const f=await fixture();await enqueue(db,f.job);const job=await claim(db);
    assert.equal(await begin(db,job,{evidence:f.event}),false);assert.equal(await count("public.message_outbox"),0);
    await scalar(db,"select public.cancel_channel_job($1,$2,$3,$4,'transport_unavailable') result",
      [id(1),job.operation_id,job.lease_owner,job.fence]);
    await reject(db,()=>enqueue(db,{...f.job,key:"retry-other-rule",request:{...f.job.request,operationId:id(62)}}));
    assert.equal((await evidence(f)).privateReply,"reserved");
  });
  await isolated("an in-flight or unknown private reply is consumed, even if a job is reset",async()=>{
    const f=await fixture();await enqueue(db,f.job);const job=await claim(db);
    await db.query(`insert into public.message_outbox(workspace_id,operation_id,fence,state,policy_evidence_id,policy_valid_until)
      values ($1,$2,$3,'sending',$4,now()+interval '1 hour')`,[id(1),job.operation_id,job.fence,f.event]);
    assert.equal((await evidence(f)).privateReply,"consumed");
    await db.query("update public.message_jobs set state='unknown',lease_owner=null,lease_until=null where operation_id=$1",[job.operation_id]);
    assert.equal((await evidence(f)).privateReply,"consumed");
    await db.query("update public.message_jobs set state='pending',lease_owner=null,lease_until=null where operation_id=$1",[job.operation_id]);
    assert.equal((await evidence(f)).privateReply,"consumed");
    await reject(db,()=>enqueue(db,{...f.job,key:"unknown-competing",request:{...f.job.request,operationId:id(62)}}));
  });
}

export async function runCommentReservationChecks(context) {
  await runOwnershipChecks(context);
  await runEligibilityChecks(context);
  await runSafetyChecks(context);
}
