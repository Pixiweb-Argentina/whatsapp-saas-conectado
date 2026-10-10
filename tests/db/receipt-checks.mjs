import assert from "node:assert/strict";
function createReceiptChecks({db,id,scalar,enqueue,claim,begin,finish,reject,isolated}) {
  const receipt=(patch={})=>({connectionId:id(51),provider:"ycloud",externalAccountId:"+15555550100",
    providerEventId:"receipt.fixture",status:"read",wamid:"wamid.receipt",providerMessageId:"provider.receipt",
    operationId:id(61),recipient:"+15555550101",occurredAt:new Date().toISOString(),...patch});
  const persistReceipt=(value,workspace=1,integration=11)=>scalar(db,"select public.persist_channel_receipt($1,$2,$3) result",[id(workspace),id(integration),value]);
  const recoverReceipts=()=>scalar(db,"select public.reconcile_channel_receipts($1,50) result",[id(1)]);
  const message=async()=> (await db.query("select status,wamid,meta,error_message from public.messages where channel_operation_id=$1",[id(61)])).rows[0];
  const job=async()=> (await db.query("select * from public.message_jobs where operation_id=$1",[id(61)])).rows[0];
  async function permitted() {await enqueue(db);const run=await claim(db);assert.equal(await begin(db,run),true);return run;}

  return {db,id,scalar,enqueue,claim,begin,finish,reject,isolated,receipt,persistReceipt,recoverReceipts,message,job,permitted};
}

async function checkReceiptTransitions({db,id,scalar,enqueue,claim,begin,finish,reject,isolated,receipt,persistReceipt,recoverReceipts,message,job,permitted}) {
  await isolated("receipt confirms unknown by YCloud operation reference without resend, and stale worker is fenced out",async()=>{
    const run=await permitted();assert.equal(await finish(db,run,{status:"unknown",operationId:id(61)}),true);
    const value=receipt();const key=await persistReceipt(value);assert.equal(await persistReceipt(value),key);
    assert.equal((await job()).state,"accepted");assert.equal((await message()).status,"read");
    assert.equal((await message()).error_message,null);assert.equal((await message()).meta.send_outcome,"accepted");
    assert.equal(await finish(db,run,{status:"unknown",operationId:id(61)}),false);
    assert.equal(await scalar(db,"select count(*)::int result from public.message_outbox"),1);
    assert.equal(await scalar(db,"select count(*)::int result from private.channel_delivery_receipts"),1);
    assert.equal(await claim(db),undefined);
  });
  await isolated("receipt arriving before stored IDs remains durable then reconciles after finish, without another message",async()=>{
    const run=await permitted();const value=receipt({operationId:null});
    await persistReceipt(value);assert.equal(await recoverReceipts(),0);assert.equal((await message()).status,"queued");
    assert.equal(await finish(db,run,{status:"accepted",externalId:"provider.receipt",providerMessageId:"provider.receipt"}),true);
    assert.equal(await recoverReceipts(),1);assert.equal(await recoverReceipts(),0);assert.equal((await message()).status,"read");
    assert.equal((await message()).wamid,"wamid.receipt");
    assert.equal(await scalar(db,"select count(*)::int result from public.messages where channel_operation_id=$1",[id(61)]),1);
  });
  await isolated("out-of-order and duplicate receipts retain read, record contradiction and never re-enqueue",async()=>{
    await permitted();await persistReceipt(receipt());
    for(const status of ["delivered","sent","failed"]) await persistReceipt(receipt({status,providerEventId:status}));
    assert.equal((await message()).status,"read");assert.equal((await message()).meta.delivery_conflict,true);
    assert.equal((await message()).error_message,null);assert.equal((await job()).state,"accepted");
    assert.equal(await recoverReceipts(),0);
  });
  await isolated("a confirmed delivery failure stays failed until positive device evidence, without a retry",async()=>{
    await permitted();await persistReceipt(receipt({status:"failed"}));
    assert.equal((await message()).status,"failed");assert.equal((await job()).state,"accepted");
    await persistReceipt(receipt({status:"sent",providerEventId:"late-sent"}));assert.equal((await message()).status,"failed");
    await persistReceipt(receipt({status:"delivered",providerEventId:"device-delivered"}));
    assert.equal((await message()).status,"delivered");assert.equal((await message()).meta.delivery_conflict,true);
    assert.equal(await claim(db),undefined);
  });
}

async function checkReceiptBoundaries({db,id,scalar,enqueue,claim,begin,finish,reject,isolated,receipt,persistReceipt,recoverReceipts,message,job,permitted}) {
  await isolated("receipt scope, IDs and recipient must agree; conflicts never mutate the job",async()=>{
    const run=await permitted();await finish(db,run,{status:"accepted",externalId:"provider.receipt",providerMessageId:"provider.receipt",wamid:"wamid.receipt"});
    await reject(db,()=>persistReceipt(receipt(),2),"42501");await reject(db,()=>persistReceipt(receipt(),1,12),"42501");
    await reject(db,()=>persistReceipt(receipt({externalAccountId:"wrong"})),"42501");
    await persistReceipt(receipt({recipient:"+15555550999"}));assert.equal((await message()).status,"sent");
    await persistReceipt(receipt({providerEventId:"bad-id",wamid:"wamid.other"}));assert.equal((await message()).status,"sent");
    const value=receipt({providerEventId:"good"});await persistReceipt(value);
    await reject(db,()=>persistReceipt({...value,status:"failed"}));assert.equal((await message()).status,"read");
  });
  await isolated("a receipt without a durable send permit never authorizes or schedules a send",async()=>{
    await enqueue(db);await persistReceipt(receipt());assert.equal((await job()).state,"pending");assert.equal(await message(),undefined);
    assert.equal(await scalar(db,"select count(*)::int result from public.message_outbox"),0);
    assert.equal(await scalar(db,"select count(*)::int result from public.message_batches"),0);
  });
  await isolated("unknown without provider correlation remains unknown; matching body or phone is insufficient",async()=>{
    const run=await permitted();await finish(db,run,{status:"unknown",operationId:id(61)});
    await persistReceipt(receipt({operationId:null}));assert.equal(await recoverReceipts(),0);
    assert.equal((await job()).state,"unknown");assert.equal((await message()).meta.send_outcome,"unknown");
    assert.equal(await claim(db),undefined);
  });
  await isolated("private receipts and service RPCs remain denied to browser roles",async()=>{
    for(const role of ["anon","authenticated"]) {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await reject(db,()=>db.query("select * from private.channel_delivery_receipts"),"42501");
      await reject(db,()=>persistReceipt(receipt()),"42501");await reject(db,recoverReceipts,"42501");
      await db.exec("RESET ROLE");
    }
    await db.exec("SET LOCAL ROLE service_role");await permitted();await persistReceipt(receipt());
    assert.equal((await message()).status,"read");
  });
}

export async function runReceiptDatabaseChecks(context) {
  const checks=createReceiptChecks(context);
  await checkReceiptTransitions(checks);
  await checkReceiptBoundaries(checks);
}
