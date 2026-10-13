import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
export const billToSchema = z.object({
  firstName: text(60), lastName: text(60), email: z.string().trim().email().max(254),
  address1: text(60), address2: z.string().trim().max(60).optional(), locality: text(50),
  administrativeArea: z.string().trim().max(50).optional(), postalCode: text(10),
  country: z.string().regex(/^[A-Z]{2}$/), phoneNumber: z.string().trim().max(25).optional(),
}).strict();
