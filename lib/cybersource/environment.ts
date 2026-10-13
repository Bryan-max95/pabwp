export type GatewayEnvironment = 'sandbox' | 'production';

export function gatewayEnvironment(): GatewayEnvironment {
  const value = process.env.CYBERSOURCE_ENVIRONMENT?.trim() || 'sandbox';
  if (value !== 'sandbox' && value !== 'production') throw new Error('Invalid CYBERSOURCE_ENVIRONMENT');
  return value;
}

export function gatewayEndpoints(environment: GatewayEnvironment = gatewayEnvironment()) {
  if (environment !== 'sandbox' && environment !== 'production') throw new Error('Invalid gateway environment');
  return environment === 'production' ? {
    api: 'https://api.cybersource.com', host: 'api.cybersource.com',
    flex: 'https://flex.cybersource.com', cardinal: 'https://centinelapi.cardinalcommerce.com',
  } : {
    api: 'https://apitest.cybersource.com', host: 'apitest.cybersource.com',
    flex: 'https://testflex.cybersource.com', cardinal: 'https://centinelapistag.cardinalcommerce.com',
  };
}
