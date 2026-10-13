import { z } from 'zod';
import { storeganiseGet } from './client';
import { StoreganiseIntegrationError } from './config';

export const sgId = z.string().regex(/^[a-f0-9]{24}$/i);
const id = sgId;
export const invoiceSchema = z.object({
  id, owner: z.object({ id }), unitRentalId: id, siteId: id,
  state: z.string(), balance: z.number().finite(), total: z.number().finite(),
  deleted: z.boolean().optional(), currency: z.string().optional(), currencyCode: z.string().optional(),
  payments: z.array(z.object({ id: z.string(), amount: z.number().finite(), type: z.string(),
    method: z.string().optional(), notes: z.string().optional(), deleted: z.boolean().optional(),
  }).passthrough()),
}).passthrough();
export const rentalSchema = z.object({ id, ownerId: id, unitId: id, siteId: id,
  state: z.string(), moveInJobId: id.optional(), endDate: z.string().nullable().optional(),
}).passthrough();
export const unitSchema = z.object({ id, siteId: id, name: z.string(), state: z.string(),
  ownerId: id.nullable().optional(), rentalId: id.nullable().optional(),
}).passthrough();
export const jobSchema = z.object({ id, ownerId: id, type: z.string(), state: z.string(),
  result: z.object({ invoiceId: id.optional(), unitRentalId: id.optional(), unitId: id.optional(), siteId: id.optional() }).passthrough(),
  steps: z.array(z.object({ id: z.string().min(1).max(100), type: z.string(), state: z.string(),
    result: z.object({ invoiceId: id.optional() }).passthrough().optional(), requiresInput: z.boolean().optional(),
  }).passthrough()),
}).passthrough();
export const userSchema = z.object({ id, firstName: z.string(), lastName: z.string(), email: z.string().email(),
  name: z.string().optional(), address: z.string().optional(), phone: z.string().optional(),
  isDisabled: z.boolean().optional(), customFields: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

function sameRecord<T extends {id:string}>(requested:string,record:T):T {
  if(record.id!==requested)throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH',403);
  return record;
}
export const getInvoice = async (value: string) => sameRecord(value,invoiceSchema.parse(await storeganiseGet(`/invoices/${sgId.parse(value)}`)));
export const getRental = async (value: string) => sameRecord(value,rentalSchema.parse(await storeganiseGet(`/unit-rentals/${sgId.parse(value)}`)));
export const getUnit = async (value: string) => sameRecord(value,unitSchema.parse(await storeganiseGet(`/units/${sgId.parse(value)}`)));
export const getJob = async (value: string) => sameRecord(value,jobSchema.parse(await storeganiseGet(`/jobs/${sgId.parse(value)}`)));
export const getUser = async (value: string) => sameRecord(value,userSchema.parse(await storeganiseGet(`/users/${sgId.parse(value)}?include=customFields`)));

export function usdAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 99999999 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    throw new StoreganiseIntegrationError('INVALID_INVOICE_AMOUNT');
  }
  return value.toFixed(2);
}

export async function invoiceContext(invoiceId: string, customerId: string, orderId?: string) {
  const invoice = await getInvoice(invoiceId);
  const rental = await getRental(invoice.unitRentalId);
  const unit = await getUnit(rental.unitId);
  const jobId = orderId ?? rental.moveInJobId;
  const job = jobId ? await getJob(jobId) : undefined;
  if (invoice.owner.id !== customerId || rental.ownerId !== customerId || rental.id !== invoice.unitRentalId ||
    unit.id !== rental.unitId || unit.siteId !== rental.siteId || invoice.siteId !== rental.siteId ||
    (unit.ownerId && unit.ownerId !== customerId) || (unit.rentalId && unit.rentalId !== rental.id) ||
    (job && (job.ownerId !== customerId || job.type !== 'unit_moveIn' ||
      (job.result.unitRentalId && job.result.unitRentalId !== rental.id) ||
      (job.result.unitId && job.result.unitId !== unit.id))) ||
    (orderId && job?.result.invoiceId !== invoice.id)) throw new StoreganiseIntegrationError('STOREGANISE_IDENTITY_MISMATCH', 403);
  return { invoice, rental, unit, job };
}

export function assertPayable(context: Awaited<ReturnType<typeof invoiceContext>>) {
  const { invoice, rental, unit, job } = context;
  if (invoice.deleted || !['sent', 'overdue'].includes(invoice.state) || invoice.balance <= 0 ||
    ['cancelled', 'canceled', 'archived', 'ended'].includes(rental.state) || rental.endDate ||
    ['archived', 'blocked', 'unassigned'].includes(unit.state) ||
    (job && ['cancelled', 'canceled', 'failed'].includes(job.state))) throw new StoreganiseIntegrationError('INVOICE_NOT_PAYABLE');
  usdAmount(invoice.balance);
}
