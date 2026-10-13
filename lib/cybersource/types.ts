/** Only non-sensitive card metadata leaves the token verification boundary. */
export type CardType = '001' | '002' | '003';

export interface CaptureContextResult {
  captureContext: string;
  clientLibrary: string;
  clientLibraryIntegrity: string;
  expiresAt: string;
}

export interface VerifiedTransientToken {
  tokenJwt: string;
  tokenId: string;
  cardType: CardType;
  brand: 'Visa' | 'Mastercard' | 'American Express';
  last4?: string;
  expiresAt: string;
}

export interface BillTo {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  locality: string;
  administrativeArea?: string;
  postalCode?: string;
  country: string;
  email: string;
  phoneNumber?: string;
}

export interface BrowserDevice {
  httpAcceptContent: string;
  httpBrowserLanguage: string;
  httpBrowserJavaEnabled: boolean;
  httpBrowserJavaScriptEnabled: boolean;
  httpBrowserColorDepth: number;
  httpBrowserScreenHeight: number;
  httpBrowserScreenWidth: number;
  httpBrowserTimeDifference: number;
  userAgentBrowserValue: string;
  ipAddress?: string;
}

export interface AuthenticationSetup {
  transactionId?: string;
  referenceId: string;
  accessToken: string;
  deviceDataCollectionUrl: string;
}

/** Fields must originate from an authenticated CyberSource server response. */
export interface AuthenticationProof {
  cavv?: string;
  ucafAuthenticationData?: string;
  ucafCollectionIndicator?: string;
  xid?: string;
  directoryServerTransactionId?: string;
  paSpecificationVersion?: string;
  eciRaw?: string;
  paresStatus?: string;
  authenticationTransactionId?: string;
}

export interface AuthenticationResult {
  status: 'authenticated' | 'challenge_required' | 'failed';
  gatewayStatus: string;
  transactionId?: string;
  paresStatus?: string;
  authenticationResult?: string;
  authenticationMessage?: string;
  authenticationTransactionId?: string;
  accessToken?: string;
  stepUpUrl?: string;
  commerceIndicator?: string;
  authentication?: AuthenticationProof;
  reason?: string;
}

export interface AuthenticationCheckInput {
  token: VerifiedTransientToken;
  reference: string;
  referenceId: string;
  returnUrl: string;
  amount: string;
  currency: string;
  billTo: BillTo;
  device: BrowserDevice;
  customerId: string;
}

export interface PaymentInput {
  token: VerifiedTransientToken;
  reference: string;
  amount: string;
  currency: string;
  billTo: BillTo;
  customerId: string;
  authentication: AuthenticationResult;
}

export interface PaymentResult {
  transactionId?: string;
  status: 'succeeded' | 'authorized' | 'declined' | 'pending' | 'unknown';
  gatewayStatus: string;
  amount?: string;
  currency?: string;
  reference?: string;
  authorizationCode?: string;
  reason?: string;
  submittedAt?: string;
  authentication?: AuthenticationResult;
}

export interface CancellationResult {
  transactionId?: string;
  status: 'voided' | 'reversed' | 'pending' | 'unknown' | 'declined';
  gatewayStatus: string;
  reason?: string;
}

export interface CyberSourceConfig {
  merchantId: string;
  keyId: string;
  sharedSecret: string;
  targetOrigin: string;
}
