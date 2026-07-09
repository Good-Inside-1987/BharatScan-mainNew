export interface BrokerCredentials {
  apiKey: string;
  clientCode: string;
  pin: string;
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
}
