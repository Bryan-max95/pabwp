import { NextRequest } from "next/server";
import crypto from "crypto";

/**
 * Verifies the signature of the webhook request from Storeganise.
 * Storeganise signs the exact raw body using HMAC-SHA256 encoded as Base64.
 */
export async function verifySignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const webhookSecret = process.env.STOREGANISE_WEBHOOK_SECRET?.trim();
  
  if (!webhookSecret || /^(TU_|YOUR_|CHANGE_ME|<)/i.test(webhookSecret)) return false;

  try {
    // Official webhook header and encoding: sg-signature, Base64.
    const signature = req.headers.get("sg-signature");
    
    if (!signature) {
      console.error("Webhook verification failed: Signature header is missing.");
      return false;
    }

    const computedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("base64");

    // Secure comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(computedSignature, "utf8")
    );

    if (!isValid) {
      console.error("Webhook verification failed: Invalid signature.");
    }

    return isValid;
  } catch (error) {
    // Log the error securely without showing credentials
    console.error("Error during webhook signature verification:", error instanceof Error ? error.message : "Unknown error");
    return false;
  }
}
