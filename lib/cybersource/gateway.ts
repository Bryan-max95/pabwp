import crypto from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK, type JWTPayload } from 'jose';
import { loadCredentials } from '../pay/credentials';
import { startAuthorizationAudit } from './authorization-audit';
import { merchantCustomerReference } from './customer-reference';
import { gatewayEnvironment, gatewayEndpoints, type GatewayEnvironment } from './environment';
import type { AuthenticationCheckInput, AuthenticationResult, AuthenticationSetup, BillTo, BrowserDevice, CaptureContextResult, PaymentResult, VerifiedTransientToken } from './types';

export const SANDBOX_ORIGIN = 'https://apitest.cybersource.com';
type Json = Record<string, any>;

export class GatewayError extends Error {
  constructor(public readonly status: number, public readonly reason: string, public readonly transactionId?: string) {
    super(`CyberSource: ${status} ${reason}`);
    this.name = 'GatewayError';
  }
}

/** Never logs request bodies, authorization headers, credentials or tokens. */
async function request<T>(environment: GatewayEnvironment, method: string, path: string, body?: unknown, asJwt = false): Promise<T> {
  const config = await loadCredentials(environment);
  const endpoints = gatewayEndpoints(environment);
  const HOST = endpoints.host;
  const date = new Date().toUTCString();
  // Update only financial authorization; preserve the working Microform/3DS transport.
  const isAuthorization = method === 'POST' && path === '/pts/v2/payments';
  const dateHeader = isAuthorization ? 'v-c-date' : 'date';
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const digest = raw === undefined ? undefined : `SHA-256=${crypto.createHash('sha256').update(raw).digest('base64')}`;
  const signing = [`host: ${HOST}`, `${dateHeader}: ${date}`, `(request-target): ${method.toLowerCase()} ${path}`,
    ...(digest ? [`digest: ${digest}`] : []), `v-c-merchant-id: ${config.merchantId}`].join('\n');
  const signedHeaders = `host ${dateHeader} (request-target)${digest ? ' digest' : ''} v-c-merchant-id`;
  const signature = crypto.createHmac('sha256', Buffer.from(config.sharedSecret, 'base64')).update(signing).digest('base64');
  const headers = { Accept: asJwt ? 'application/jwt' : '*/*', 'Content-Type': 'application/json',
    Host: HOST, [dateHeader]: date, 'v-c-merchant-id': config.merchantId,
    ...(digest ? { Digest: digest } : {}),
    Signature: `keyid="${config.keyId}", algorithm="HmacSHA256", headers="${signedHeaders}", signature="${signature}"` };
  const audit = environment === 'sandbox' && isAuthorization && raw ? await startAuthorizationAudit(raw, new Headers(headers), config) : undefined;
  const response = await fetch(`${endpoints.api}${path}`, {
    method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25_000),
    headers, body: raw,
  });
  const text = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (audit) await audit(response.status, parsed);
  if (!response.ok) {
    const error = typeof parsed === 'object' && parsed ? parsed as Json : {};
    const reason = String(error.errorInformation?.reason ?? error.reason ?? error.response?.rmsg ??
      `REQUEST_REJECTED (${response.headers.get('content-type') ?? 'unknown'}; fields: ${Object.keys(error).join(',')})`).replace(/[^a-zA-Z0-9_ .,;:/()-]/g, '').slice(0, 160);
    throw new GatewayError(response.status, reason, typeof error.id === 'string' && /^\d{12,30}$/.test(error.id) ? error.id : undefined);
  }
  return parsed as T;
}

const publicKeys = new Map<string, Promise<CryptoKey>>();
async function verifyCaptureContext(token: string, environment: GatewayEnvironment): Promise<JWTPayload> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== 'RS256' || !header.kid || !/^[a-zA-Z0-9_-]{1,100}$/.test(header.kid)) throw new Error('Invalid capture context header');
  const cacheKey = `${environment}:${header.kid}`;
  if (!publicKeys.has(cacheKey)) {
    const id = header.kid;
    publicKeys.set(cacheKey, (async () => {
      const response = await fetch(`${gatewayEndpoints(environment).api}/flex/v2/public-keys/${encodeURIComponent(id)}`, {
        redirect: 'error', signal: AbortSignal.timeout(15_000), cache: 'no-store',
      });
      if (!response.ok) throw new Error('Capture context verification key unavailable');
      const jwk = await response.json() as JWK;
      return await importJWK(jwk, 'RS256') as CryptoKey;
    })().catch(error => { publicKeys.delete(cacheKey); throw error; }));
  }
  const verified = await jwtVerify(token, await publicKeys.get(cacheKey)!, { algorithms: ['RS256'], requiredClaims: ['exp', 'iat'] });
  return verified.payload;
}

export class CyberSourceGateway {
  constructor(readonly environment: GatewayEnvironment = gatewayEnvironment()) { gatewayEndpoints(environment); }

  private request<T>(method: string, path: string, body?: unknown, asJwt = false) {
    return request<T>(this.environment, method, path, body, asJwt);
  }

  private authenticationResult(data: Json): AuthenticationResult {
    const info = data.consumerAuthenticationInformation ?? {};
    const status = String(data.status ?? '');
    const pares = String(info.paresStatus ?? '');
    const authenticated = status === 'AUTHENTICATION_SUCCESSFUL' && ['Y', 'A'].includes(pares);
    const challenge = status === 'PENDING_AUTHENTICATION' && pares === 'C';
    return { status: authenticated ? 'authenticated' : challenge ? 'challenge_required' : 'failed', gatewayStatus: status || 'UNKNOWN',
      transactionId: typeof data.id === 'string' ? data.id : undefined,
      paresStatus: pares, authenticationResult: info.authenticationResult === undefined ? undefined : String(info.authenticationResult),
      authenticationMessage: typeof info.authenticationStatusMsg === 'string' ? info.authenticationStatusMsg : undefined,
      authenticationTransactionId: typeof info.authenticationTransactionId === 'string' ? info.authenticationTransactionId : undefined,
      accessToken: typeof info.accessToken === 'string' ? info.accessToken : undefined,
      stepUpUrl: typeof info.stepUpUrl === 'string' ? info.stepUpUrl : undefined,
      commerceIndicator: typeof info.indicator === 'string' ? info.indicator : typeof info.ecommerceIndicator === 'string' ? info.ecommerceIndicator : undefined,
      authentication: { cavv: info.cavv, ucafAuthenticationData: info.ucafAuthenticationData, ucafCollectionIndicator: info.ucafCollectionIndicator,
        // Payer Authentication responds with specificationVersion; Payments expects paSpecificationVersion.
        // Carry the provider's ECI and PARes unchanged into the separate authorization.
        xid: info.xid, directoryServerTransactionId: info.directoryServerTransactionId, paSpecificationVersion: info.specificationVersion,
        eciRaw: info.eciRaw, paresStatus: info.paresStatus,
        authenticationTransactionId: info.authenticationTransactionId }, reason: data.errorInformation?.reason ?? (typeof info.cardholderMessage === 'string' ? info.cardholderMessage : undefined) };
  }

  async setupAuthentication(token: VerifiedTransientToken, reference: string): Promise<AuthenticationSetup> {
    const data = await this.request<Json>('POST', '/risk/v1/authentication-setups', {
      clientReferenceInformation: { code: reference }, tokenInformation: { transientToken: token.tokenId },
    });
    const info = data.consumerAuthenticationInformation;
    if (data.status !== 'COMPLETED' || !info?.referenceId || !info.accessToken || !info.deviceDataCollectionUrl) throw new Error('Authentication setup incomplete');
    assertAuthenticationUrl(info.deviceDataCollectionUrl, this.environment);
    return { transactionId: typeof data.id === 'string' ? data.id : undefined, referenceId: info.referenceId, accessToken: info.accessToken, deviceDataCollectionUrl: info.deviceDataCollectionUrl };
  }

  async authenticate(input: AuthenticationCheckInput): Promise<AuthenticationResult> {
    const data = await this.request<Json>('POST', '/risk/v1/authentications', {
      clientReferenceInformation: { code: input.reference },
      tokenInformation: { transientToken: input.token.tokenId },
      paymentInformation: { card: { type: input.token.cardType } },
      orderInformation: { amountDetails: { totalAmount: input.amount, currency: input.currency }, billTo: input.billTo },
      buyerInformation: { merchantCustomerId: merchantCustomerReference(input.customerId), mobilePhone: input.billTo.phoneNumber },
      deviceInformation: input.device,
      consumerAuthenticationInformation: { deviceChannel: 'BROWSER', transactionMode: 'eCommerce', referenceId: input.referenceId, returnUrl: input.returnUrl, acsWindowSize: '05' },
    });
    return this.authenticationResult(data);
  }

  async validateAuthentication(input: { token: VerifiedTransientToken; reference: string; authenticationTransactionId: string }): Promise<AuthenticationResult> {
    const data = await this.request<Json>('POST', '/risk/v1/authentication-results', {
      clientReferenceInformation: { code: input.reference },
      paymentInformation: { card: { type: input.token.cardType } },
      consumerAuthenticationInformation: { authenticationTransactionId: input.authenticationTransactionId },
    });
    const result = this.authenticationResult(data);
    // The validation service may answer successfully before the issuer has a PARes.
    // Service success alone never authorizes, nor is it a cardholder decline.
    if (data.status === 'AUTHENTICATION_SUCCESSFUL' && !result.paresStatus) return { ...result, status: 'challenge_required' };
    return result;
  }

  async createCaptureContext(): Promise<CaptureContextResult> {
    const origin = new URL(process.env.PAY_PUBLIC_URL ?? '').origin;
    if (this.environment === 'production' && new URL(origin).protocol !== 'https:') throw new Error('Production checkout requires HTTPS');
    const token = await this.request<string>('POST', '/microform/v2/sessions', {
      clientVersion: 'v2', targetOrigins: [origin], allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX'],
      transientTokenResponseOptions: { includeCardPrefix: false },
    }, true);
    if (typeof token !== 'string') throw new Error('Invalid capture context response');
    return this.readCaptureContext(token);
  }

  async readCaptureContext(token: string): Promise<CaptureContextResult> {
    const origin = new URL(process.env.PAY_PUBLIC_URL ?? '').origin;
    const payload = await verifyCaptureContext(token, this.environment);
    const contexts = payload.ctx as Array<{ data?: Json }> | undefined;
    const data = contexts?.find(item => item.data?.clientLibrary)?.data;
    const clientLibrary = String(data?.clientLibrary ?? '');
    const clientLibraryIntegrity = String(data?.clientLibraryIntegrity ?? '');
    const library = new URL(clientLibrary);
    if (library.origin !== gatewayEndpoints(this.environment).flex || library.username || library.password ||
      !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(clientLibraryIntegrity) || !data?.targetOrigins?.includes(origin)) {
      throw new Error('Invalid capture context configuration');
    }
    return { captureContext: token, clientLibrary, clientLibraryIntegrity, expiresAt: new Date(payload.exp! * 1000).toISOString() };
  }

  async verifyTransientToken(tokenJwt: string, captureContext: string): Promise<VerifiedTransientToken> {
    const context = await verifyCaptureContext(captureContext, this.environment);
    const jwk = (context.flx as { jwk?: JWK } | undefined)?.jwk;
    if (!jwk?.n || !jwk.e || jwk.kty !== 'RSA') throw new Error('Capture context key missing');
    const key = await importJWK({ kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' }, 'RS256');
    const { payload } = await jwtVerify(tokenJwt, key, { algorithms: ['RS256'], requiredClaims: ['jti', 'exp', 'iat'] });
    const data = (payload.content ?? payload.data) as Json | undefined;
    const card = data?.paymentInformation?.card ?? data;
    const detected = card?.number?.detectedCardTypes;
    const type = String(card?.type?.value ?? card?.type ?? (Array.isArray(detected) && detected.length === 1 ? detected[0] : ''));
    if (!['001', '002', '003'].includes(type)) throw new Error('Unsupported card brand');
    const masked = String(card?.number?.maskedValue ?? card?.number ?? '');
    const last4 = /(?:X|\*|•).*?(\d{4})$/i.exec(masked)?.[1];
    return { tokenJwt, tokenId: payload.jti!, cardType: type as VerifiedTransientToken['cardType'],
      brand: type === '001' ? 'Visa' : type === '002' ? 'Mastercard' : 'American Express',
      ...(last4 ? { last4 } : {}), expiresAt: new Date(payload.exp! * 1000).toISOString() };
  }

  async pay(input: { token: VerifiedTransientToken; reference: string; amount: string; currency: string;
    billTo: BillTo; customerId: string; device: BrowserDevice; authentication: AuthenticationResult }): Promise<PaymentResult> {
    const auth = input.authentication;
    if (auth.status !== 'authenticated' || !auth.commerceIndicator ||
      (input.token.cardType === '002' ? !auth.authentication?.ucafAuthenticationData || !auth.authentication.ucafCollectionIndicator : !auth.authentication?.cavv)) {
      throw new Error('Verified authentication proof required');
    }
    return this.submitPayment(input, true, auth);
  }

  /** Server-only diagnostic. Caller must restrict this to a fresh, isolated local demo. */
  async authorizeOnly(input: { token: VerifiedTransientToken; reference: string; amount: string; currency: string;
    billTo: BillTo; customerId: string; device: BrowserDevice }): Promise<PaymentResult> {
    if (this.environment !== 'sandbox') throw new Error('Diagnostic authorization is sandbox-only');
    return this.submitPayment(input, false);
  }

  private async submitPayment(input: { token: VerifiedTransientToken; reference: string; amount: string; currency: string;
    billTo: BillTo; customerId: string; device: BrowserDevice }, capture: boolean, authentication?: AuthenticationResult): Promise<PaymentResult> {
    const body = { clientReferenceInformation: { code: input.reference }, processingInformation: { capture,
        ...(authentication ? { commerceIndicator: authentication.commerceIndicator } : {}) },
      tokenInformation: { jti: input.token.tokenId },
      paymentInformation: { card: { type: input.token.cardType } },
      deviceInformation: input.device,
      orderInformation: { amountDetails: { totalAmount: input.amount, currency: input.currency }, billTo: input.billTo },
      buyerInformation: { merchantCustomerId: merchantCustomerReference(input.customerId) },
      ...(authentication ? { consumerAuthenticationInformation: authentication.authentication } : {}) };
    try {
      const data = await this.request<Json>('POST', '/pts/v2/payments', body);
      const status = String(data.status ?? 'UNKNOWN');
      const transactionId = typeof data.id === 'string' ? data.id : undefined;
      const confirmedAmount = data.orderInformation?.amountDetails?.authorizedAmount;
      const confirmedCurrency = data.orderInformation?.amountDetails?.currency;
      const matches = (confirmedAmount === undefined || Number(confirmedAmount).toFixed(2) === input.amount) &&
        (confirmedCurrency === undefined || confirmedCurrency === input.currency);
      const success = matches && Boolean(transactionId) && status === 'AUTHORIZED';
      // A sale can authorize successfully while its capture fails. A transaction
      // ID requires reconciliation before this session may offer another payment.
      const declined = !transactionId && ['DECLINED', 'INVALID_REQUEST', 'FAILED'].includes(status);
      return { transactionId, status: success ? (capture ? 'succeeded' : 'authorized') : declined ? 'declined' : transactionId ? 'pending' : 'unknown',
        gatewayStatus: matches ? status : 'AMOUNT_MISMATCH', amount: confirmedAmount, currency: confirmedCurrency,
        reference: input.reference, authorizationCode: data.processorInformation?.approvalCode,
        reason: data.errorInformation?.reason, submittedAt: data.submitTimeUtc,
        ...(status === 'PENDING_AUTHENTICATION' ? { authentication: this.authenticationResult(data) } : {}) };
    } catch (error) {
      if (error instanceof GatewayError && !error.transactionId && [400, 401, 403, 404, 422].includes(error.status)) {
        return { status: 'declined', gatewayStatus: `HTTP_${error.status}`, reason: error.reason, transactionId: error.transactionId };
      }
      return { status: 'unknown', gatewayStatus: error instanceof GatewayError ? `HTTP_${error.status}` : 'NETWORK_UNCERTAIN',
        transactionId: error instanceof GatewayError ? error.transactionId : undefined,
        reason: error instanceof GatewayError ? error.reason : 'Verification required before any retry' };
    }
  }

  async getPayment(id: string) { return this.request<Json>('GET', `/tss/v2/transactions/${encodeURIComponent(id)}`); }
  async voidPayment(id: string, reference: string) {
    return this.request<Json>('POST', `/pts/v2/payments/${encodeURIComponent(id)}/voids`, { clientReferenceInformation: { code: reference } });
  }
  async reverseAuthorization(id: string, reference: string, amount: string, currency: string) {
    return this.request<Json>('POST', `/pts/v2/payments/${encodeURIComponent(id)}/reversals`, {
      clientReferenceInformation: { code: reference }, reversalInformation: { amountDetails: { totalAmount: amount, currency } },
    });
  }
}

export function assertAuthenticationUrl(value: string, environment: GatewayEnvironment) {
  const url = new URL(value);
  if (url.origin !== gatewayEndpoints(environment).cardinal || url.username || url.password) throw new Error('Unexpected authentication URL');
}
