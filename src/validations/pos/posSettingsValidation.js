const { z } = require('zod');

const taxRateItemSchema = z.object({
  id: z.string().default(() => `tax-${Date.now()}`),
  name: z.string().trim().min(1, 'Tax name cannot be empty').max(100),
  percentage: z.coerce.number().min(0, 'Tax percentage must be >= 0').max(100, 'Tax percentage cannot exceed 100'),
});

const updatePosSettingsSchema = z.object({
  storeName: z.string().trim().max(150).optional(),
  storeTagline: z.string().trim().max(255).nullable().optional(),
  storeLogoUrl: z.string().nullable().optional(),
  storeLogoInitial: z.string().trim().max(10).optional(),
  
  addressLine1: z.string().trim().max(255).nullable().optional(),
  addressLine2: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  state: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(30).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().max(150).nullable().optional(),
  website: z.string().trim().max(255).nullable().optional(),
  gstTaxNumber: z.string().trim().max(60).nullable().optional(),

  taxes: z.array(taxRateItemSchema).optional(),
  isTaxInclusive: z.boolean().optional(),

  upiId: z.string().trim().max(100).nullable().optional(),
  upiPayeeName: z.string().trim().max(150).nullable().optional(),
  upiQrType: z.enum(['auto', 'custom']).optional(),
  upiQrImageUrl: z.string().nullable().optional(),

  receiptHeaderNote: z.string().trim().max(255).nullable().optional(),
  receiptFooterNote: z.string().trim().max(255).nullable().optional(),
  returnPolicy: z.string().trim().max(255).nullable().optional(),
  returnWindowDays: z.coerce.number().int().min(0).max(365).optional(),

  paperSize: z.string().trim().max(20).optional(),
  showTaxBreakdown: z.boolean().optional(),
  showCashierName: z.boolean().optional(),
  showCustomerInfo: z.boolean().optional(),
  showUpiQrOnReceipt: z.boolean().optional(),
  autoPrintReceipt: z.boolean().optional(),
  cashDrawerFloat: z.coerce.number().min(0).optional(),
});

module.exports = {
  updatePosSettingsSchema,
  taxRateItemSchema,
};
