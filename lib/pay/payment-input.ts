import { z } from 'zod';
import type { NextRequest } from 'next/server';
import type { BrowserDevice } from '../cybersource/types';
import { billToSchema } from './billing-details';

export const paymentRequestSchema = z.object({
  transientToken: z.string().min(100).max(30000),
  cardHolder: z.string().trim().min(1).max(150),
  expirationMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
  expirationYear: z.string().regex(/^20\d{2}$/),
  billingDetails: billToSchema.optional(),
  browser: z.object({ language: z.string().max(30), colorDepth: z.number().int().min(1).max(64),
    height: z.number().int().min(1).max(20000), width: z.number().int().min(1).max(20000),
    timezoneOffset: z.number().int().min(-1440).max(1440) }).strict(),
}).strict();

export function browserDevice(req: NextRequest, data: z.infer<typeof paymentRequestSchema>): BrowserDevice {
  const device: BrowserDevice = { httpAcceptContent: req.headers.get('accept') ?? '*/*',
    httpBrowserLanguage: data.browser.language, httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true,
    httpBrowserColorDepth: data.browser.colorDepth, httpBrowserScreenHeight: data.browser.height,
    httpBrowserScreenWidth: data.browser.width, httpBrowserTimeDifference: data.browser.timezoneOffset,
    userAgentBrowserValue: req.headers.get('user-agent') ?? '' };
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
  if (ip) device.ipAddress = ip;
  return device;
}
