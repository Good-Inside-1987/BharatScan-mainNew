import type {
  Bar,
  BrokerAdapter,
  BrokerCredentials,
  OptionChainData,
  Quote,
} from "./types.js";

const ANGEL_BASE = "https://apiconnect.angelone.in";

// Angel One SmartAPI candle-data per-request date-range limits, in calendar
// days, keyed by interval string. Values are the documented practical caps;
// unknown intervals fall back to the most conservative window.
const MAX_DAYS_BY_INTERVAL: Record<string, number> = {
  ONE_MINUTE: 30,
  THREE_MINUTE: 60,
  FIVE_MINUTE: 100,
  TEN_MINUTE: 100,
  FIFTEEN_MINUTE: 200,
  THIRTY_MINUTE: 200,
  ONE_HOUR: 400,
  ONE_DAY: 2000,
};
const DEFAULT_MAX_DAYS = 30;

function maxDaysForInterval(interval: string): number {
  return MAX_DAYS_BY_INTERVAL[interval] ?? DEFAULT_MAX_DAYS;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toDateTimeString(date: Date): string {
  // Angel expects "YYYY-MM-DD HH:mm" in local exchange time; we use the
  // UTC midnight boundary of each chunk which is acceptable for day-level
  // chunk splitting purposes.
  return `${date.toISOString().slice(0, 10)} 09:15`;
}

function toEndDateTimeString(date: Date): string {
  return `${date.toISOString().slice(0, 10)} 15:30`;
}

/**
 * Splits [fromDate, toDate] into sequential chunks that each respect the
 * per-request day limit Angel One's SmartAPI imposes for the given
 * interval. Callers of getHistoricalData() never see this chunking.
 */
function chunkDateRange(
  fromDate: string,
  toDate: string,
  interval: string
): Array<{ from: string; to: string }> {
  const maxDays = maxDaysForInterval(interval);
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);

  const chunks: Array<{ from: string; to: string }> = [];
  let chunkStart = start;
  while (chunkStart <= end) {
    const chunkEnd = addDays(chunkStart, maxDays - 1);
    const clampedEnd = chunkEnd < end ? chunkEnd : end;
    chunks.push({
      from: toDateTimeString(chunkStart),
      to: toEndDateTimeString(clampedEnd),
    });
    chunkStart = addDays(clampedEnd, 1);
  }
  return chunks;
}

export class AngelAdapter implements BrokerAdapter {
  private apiKey?: string;
  private jwtToken?: string;
  private clientIp: string = "127.0.0.1";

  /**
   * Angel One's SmartAPI data endpoints require the API key and JWT token
   * from a prior login() on every request, plus the same client-IP headers
   * used during login. The shared BrokerAdapter interface only carries
   * those through login(), so callers that want to use
   * getHistoricalData/getQuotes must call this first.
   */
  configureSession(apiKey: string, jwtToken: string, clientIp = "127.0.0.1"): void {
    this.apiKey = apiKey;
    this.jwtToken = jwtToken;
    this.clientIp = clientIp;
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey || !this.jwtToken) {
      throw new Error(
        "AngelAdapter session not configured; call configureSession(apiKey, jwtToken) before requesting market data"
      );
    }
    return {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${this.jwtToken}`,
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": this.clientIp,
      "X-ClientPublicIP": this.clientIp,
      "X-MACAddress": "00:00:00:00:00:00",
      "X-PrivateKey": this.apiKey,
    };
  }

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

  /**
   * @param symbol Angel's `symboltoken` for the instrument (numeric string,
   *   e.g. "3045"). The exchange is passed separately via `exchange` query
   *   convention used elsewhere in this codebase; here we expect it encoded
   *   as "EXCHANGE:symboltoken" (e.g. "NSE:3045") to keep the signature
   *   aligned with the shared BrokerAdapter interface.
   * @param resolution Angel interval string, e.g. "ONE_DAY", "FIVE_MINUTE".
   */
  async getHistoricalData(
    symbol: string,
    resolution: string,
    fromDate: string,
    toDate: string
  ): Promise<Bar[]> {
    const [exchange, symboltoken] = symbol.includes(":")
      ? symbol.split(":")
      : ["NSE", symbol];

    const chunks = chunkDateRange(fromDate, toDate, resolution);
    const bars: Bar[] = [];

    for (const chunk of chunks) {
      const response = await fetch(
        `${ANGEL_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
        {
          method: "POST",
          headers: this.authHeaders(),
          body: JSON.stringify({
            exchange,
            symboltoken,
            interval: resolution,
            fromdate: chunk.from,
            todate: chunk.to,
          }),
        }
      );

      const data = (await response.json()) as {
        status: boolean;
        message: string;
        data?: number[][];
      };

      if (!data.status) {
        throw new Error(data.message ?? "Angel One history request failed");
      }

      for (const candle of data.data ?? []) {
        const [timestamp, open, high, low, close, volume] = candle as unknown as [
          string | number,
          string | number,
          string | number,
          string | number,
          string | number,
          string | number
        ];
        const bar: Bar = {
          date: new Date(timestamp).toISOString(),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume),
        };
        if (
          Number.isNaN(bar.open) ||
          Number.isNaN(bar.high) ||
          Number.isNaN(bar.low) ||
          Number.isNaN(bar.close) ||
          Number.isNaN(bar.volume)
        ) {
          throw new Error("Angel One history request returned malformed candle data");
        }
        bars.push(bar);
      }
    }

    return bars;
  }

  /**
   * @param symbols Each entry encoded as "EXCHANGE:symboltoken" (e.g.
   *   "NSE:3045"), matching the convention used by getHistoricalData().
   */
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const exchangeTokens: Record<string, string[]> = {};
    for (const symbol of symbols) {
      const [exchange, token] = symbol.includes(":")
        ? symbol.split(":")
        : ["NSE", symbol];
      exchangeTokens[exchange] = exchangeTokens[exchange] ?? [];
      exchangeTokens[exchange].push(token);
    }

    const response = await fetch(
      `${ANGEL_BASE}/rest/secure/angelbroking/market/v1/quote/`,
      {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          mode: "FULL",
          exchangeTokens,
        }),
      }
    );

    const data = (await response.json()) as {
      status: boolean;
      message: string;
      data?: {
        fetched?: Array<{
          exchange: string;
          symbolToken: string;
          tradingSymbol: string;
          ltp: number;
          open: number;
          high: number;
          low: number;
          close: number;
          tradeVolume?: number;
          exchFeedTime?: string;
        }>;
      };
    };

    if (!data.status) {
      throw new Error(data.message ?? "Angel One quotes request failed");
    }

    return (data.data?.fetched ?? []).map((entry) => ({
      symbol: `${entry.exchange}:${entry.symbolToken}`,
      ltp: Number(entry.ltp),
      open: Number(entry.open),
      high: Number(entry.high),
      low: Number(entry.low),
      close: Number(entry.close),
      volume: Number(entry.tradeVolume ?? 0),
      timestamp: entry.exchFeedTime
        ? new Date(entry.exchFeedTime).toISOString()
        : new Date().toISOString(),
    }));
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
