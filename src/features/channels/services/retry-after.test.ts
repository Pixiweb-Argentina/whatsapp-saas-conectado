import assert from "node:assert/strict";
import { test } from "node:test";
import { retryAfterSeconds } from "./retry-after.ts";
import { channelSendResultSchema } from "../types/send-contracts.ts";

test("Retry-After supports seconds and HTTP dates without shortening future waits",()=>{
  const now=Date.parse("2026-10-10T12:00:00Z");
  assert.equal(retryAfterSeconds(" 120 ",now),120);
  assert.equal(retryAfterSeconds("Sat, 10 Oct 2026 12:02:00 GMT",now),120);
  assert.equal(retryAfterSeconds("Sat, 10 Oct 2026 11:00:00 GMT",now),0);
  assert.equal(retryAfterSeconds("172800",now),172800);
  for(const value of [undefined,null,"","-1","1.5","tomorrow","2026-10-10","2147483648"]) assert.equal(retryAfterSeconds(value,now),undefined);
});
test("retry hints cannot authorize uncertain sends or carry invalid durations",()=>{
  const rejected={status:"rejected",errorCode:"130429",retryable:true};
  assert.equal(channelSendResultSchema.safeParse({...rejected,retryAfterSeconds:120}).success,true);
  for(const value of [-1,1.5,"120",2147483648]) assert.equal(channelSendResultSchema.safeParse({...rejected,retryAfterSeconds:value}).success,false);
  assert.equal(channelSendResultSchema.safeParse({status:"unknown",operationId:"op",retryAfterSeconds:120}).success,false);
});
