import "server-only";
import { createHmac } from "node:crypto";

export type OwnedMailConfig = { baseUrl: string; secret: string; from: string };
export type OwnedMailIdentity = { id: string; organizationId: string };
export type OwnedMailReceipt = OwnedMailIdentity & {
  state: "QUEUED" | "DISPATCHING" | "SENT" | "UNCERTAIN" | "REJECTED";
  deliveryId: string | null;
};
export class OwnedMailError extends Error {
  constructor(public readonly code: string, public readonly uncertain = true) { super(code); }
}

async function request(config: OwnedMailConfig, pathname: string, value: OwnedMailIdentity | Record<string, unknown> | null) {
  const bytes=value ? JSON.stringify(value) : "", key=value ? `notification/${value.id}` : "readiness";
  const timestamp=String(Math.floor(Date.now()/1000)),method=value?"POST":"GET";
  const signature=createHmac("sha256",config.secret).update(`${timestamp}\n${method}\n${pathname}\n${key}\n`).update(bytes).digest("hex");
  let response: Response;
  try {
    response=await fetch(config.baseUrl+pathname,{method,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(30_000),
      headers:{"content-type":"application/json","idempotency-key":key,"x-codexdentist-timestamp":timestamp,"x-codexdentist-signature":signature},
      ...(value?{body:bytes}:{})});
  }catch {throw new OwnedMailError("owned-mail-response-uncertain");}
  if(pathname==="/v1/status" && response.status===404){await response.body?.cancel();return null;}
  if(![200,202,422].includes(response.status)){await response.body?.cancel();throw new OwnedMailError("owned-mail-response-unavailable");}
  const reader=response.body?.getReader();if(!reader)throw new OwnedMailError("owned-mail-response-invalid");
  const chunks: Uint8Array[]=[];let size=0;
  try {
    for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>4096)throw new OwnedMailError("owned-mail-response-invalid");chunks.push(item.value);}
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }catch {throw new OwnedMailError("owned-mail-response-invalid");}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function receipt(value: unknown, identity: OwnedMailIdentity): OwnedMailReceipt {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new OwnedMailError("owned-mail-receipt-invalid");
  const row=value as Record<string,unknown>;
  if(row.id!==identity.id||row.organizationId!==identity.organizationId||
    !["QUEUED","DISPATCHING","SENT","UNCERTAIN","REJECTED"].includes(String(row.state))||
    (row.state==="SENT"?!/^[a-f0-9-]{36}$/.test(String(row.deliveryId)):row.deliveryId!==null))throw new OwnedMailError("owned-mail-receipt-invalid");
  return {id:identity.id,organizationId:identity.organizationId,state:row.state as OwnedMailReceipt["state"],deliveryId:row.deliveryId as string|null};
}
export async function deliverOwnedMail(config: OwnedMailConfig, input: OwnedMailIdentity & {
  recipient: string; subject: string | null; body: string; templateKey: string | null; expiresAt: number;
}) {
  const envelope={...input,channel:"EMAIL",from:config.from,subject:input.subject||"Codexdentist notification"};
  if(Buffer.byteLength(JSON.stringify(envelope))>64*1024)throw new OwnedMailError("owned-mail-content-too-large",false);
  return receipt(await request(config,"/v1/deliver",envelope),input);
}
export async function ownedMailStatus(config: OwnedMailConfig, identity: OwnedMailIdentity) {
  const scoped = {id:identity.id,organizationId:identity.organizationId};
  const value=await request(config,"/v1/status",scoped);return value===null?null:receipt(value,scoped);
}
export async function verifyOwnedMail(config: OwnedMailConfig) {
  const value=await request(config,"/ready",null);
  if(!value||typeof value!=="object"||!("ready"in value)||value.ready!==true||!("testOnly"in value)||value.testOnly!==false)throw new OwnedMailError("owned-mail-not-live");
}
