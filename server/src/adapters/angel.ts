import type { BrokerAdapter, BrokerCredentials } from "./types.js";

export class AngelAdapter implements BrokerAdapter {
  async login(
    credentials: BrokerCredentials,
    totpCode: string,
    clientIp = "127.0.0.1"
  ): Promise<string> {
    const response = await fetch(
      "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": clientIp,
          "X-ClientPublicIP": clientIp,
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": credentials.apiKey,
        },
        body: JSON.stringify({
          clientcode: credentials.clientCode,
          password: credentials.pin,
          totp: totpCode,
        }),
      }
    );

    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: { jwtToken?: string };
    };

    if (!data.status || !data.data?.jwtToken) {
      throw new Error(data.message ?? "Angel One login failed");
    }

    return data.data.jwtToken;
  }
}
