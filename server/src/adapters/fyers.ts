import { createHash } from "node:crypto";
import type { BrokerAdapter, BrokerCredentials } from "./types.js";

export class FyersAdapter implements BrokerAdapter {
  /**
   * For Fyers:
   *   credentials.apiKey     = App ID
   *   credentials.clientCode = Secret Key
   *   credentials.pin        = Redirect URI (unused in login)
   *   totpCode               = the auth code from Fyers redirect
   */
  async login(
    credentials: BrokerCredentials,
    totpCode: string
  ): Promise<string> {
    const appIdHash = createHash("sha256")
      .update(`${credentials.apiKey}:${credentials.clientCode}`)
      .digest("hex");

    const response = await fetch(
      "https://api-t1.fyers.in/api/v3/validate-authcode",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appIdHash,
          code: totpCode,
        }),
      }
    );

    const data = (await response.json()) as {
      s: string;
      message?: string;
      access_token?: string;
    };

    if (data.s !== "ok" || !data.access_token) {
      throw new Error(data.message ?? "Fyers authentication failed");
    }

    return data.access_token;
  }
}
