import type {
  Bar,
  BrokerAdapter,
  BrokerCredentials,
  OptionChainData,
  Quote,
} from "./types.js";

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

  async getHistoricalData(
    _symbol: string,
    _resolution: string,
    _fromDate: string,
    _toDate: string
  ): Promise<Bar[]> {
    throw new Error("AngelAdapter.getHistoricalData is not implemented");
  }

  async getQuotes(_symbols: string[]): Promise<Quote[]> {
    throw new Error("AngelAdapter.getQuotes is not implemented");
  }

  async getOptionChain(
    _underlying: string,
    _expiry: string
  ): Promise<OptionChainData> {
    throw new Error("AngelAdapter.getOptionChain is not implemented");
  }

  async refreshSession(_refreshToken: string): Promise<string> {
    throw new Error("AngelAdapter.refreshSession is not implemented");
  }
}
