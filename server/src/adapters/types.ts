export interface BrokerCredentials {
  apiKey: string;
  clientCode: string;
  pin: string;
}

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}

export interface OptionChainData {
  underlying: string;
  expiry: string;
  strikes: Array<{
    strike: number;
    ce: Record<string, unknown> | null;
    pe: Record<string, unknown> | null;
  }>;
}

export interface BrokerAdapter {
  /**
   * Login with credentials + TOTP code.
   * Returns the access token on success.
   * Throws an error with a human-readable message on failure.
   */
  login(
    credentials: BrokerCredentials,
    totpCode: string,
    clientIp?: string
  ): Promise<string>;

  /**
   * Fetch historical OHLCV bars for a symbol between two dates.
   */
  getHistoricalData(
    symbol: string,
    resolution: string,
    fromDate: string,
    toDate: string
  ): Promise<Bar[]>;

  /**
   * Fetch live quotes for a list of symbols.
   */
  getQuotes(symbols: string[]): Promise<Quote[]>;

  /**
   * Fetch the option chain for an underlying at a given expiry.
   */
  getOptionChain(underlying: string, expiry: string): Promise<OptionChainData>;

  /**
   * Refresh an access token using a refresh token.
   * Returns the new access token on success.
   */
  refreshSession(refreshToken: string): Promise<string>;
}
