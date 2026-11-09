import { getSession } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/request-security";
import { getBankTransferSettings, saveBankTransferSettings } from "@/lib/application/integrations/bank-transfer";
import { bankTransferBody, bankTransferError, bankTransferJson } from "../http";
export async function GET() {
  const session = await getSession(); if (!session) return bankTransferJson({ error: "login" }, 401);
  try { return bankTransferJson(await getBankTransferSettings(session)); } catch (error) { return bankTransferError(error); }
}
export async function POST(request: Request) {
  const session = await getSession(); if (!session) return bankTransferJson({ error: "login" }, 401);
  if (!hasSameOrigin(request)) return bankTransferJson({ error: "bank-transfer-origin-denied" }, 403);
  try { return bankTransferJson(await saveBankTransferSettings(session, await bankTransferBody(request))); } catch (error) { return bankTransferError(error); }
}
