import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { getBankTransferInstructions } from "@/lib/application/integrations/bank-transfer";
import { bankTransferBody, bankTransferError, bankTransferJson } from "../http";
export async function POST(request: Request) {
  const session = await getSession(); if (!session) return bankTransferJson({ error: "login" }, 401);
  if (!hasSameOrigin(request)) return bankTransferJson({ error: "bank-transfer-origin-denied" }, 403);
  try {
    const body = await bankTransferBody(request);
    return bankTransferJson(await getBankTransferInstructions(session, { patientId: body.patientId, invoiceNo: body.invoiceNo, amount: body.amount }));
  } catch (error) { return bankTransferError(error); }
}
