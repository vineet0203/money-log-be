const { z } = require('zod');

const createPosReturnSchema = z.object({
  original_order_id: z.coerce.number().int().positive('Original order ID is required'),
  refund_amount: z.coerce.number().min(0, 'Refund amount must be non-negative'),
  refund_mode: z.enum(['Store Credit', 'Cash', 'Card', 'UPI']).default('Store Credit'),
  reason: z.string().trim().max(255).optional(),
  items_summary: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  returned_items: z.array(
    z.object({
      variant_id: z.coerce.number().int().positive(),
      item_name: z.string().optional(),
      quantity: z.coerce.number().positive(),
      unit_price: z.coerce.number().min(0).optional(),
    })
  ).optional().default([]),
});

const createPosExchangeSchema = z.object({
  original_order_id: z.coerce.number().int().positive('Original order ID is required'),
  returned_items: z.array(
    z.object({
      variant_id: z.coerce.number().int().positive(),
      item_name: z.string().optional(),
      quantity: z.coerce.number().positive(),
      unit_price: z.coerce.number().min(0).optional(),
    })
  ).min(1, 'At least one item must be returned for exchange'),
  replacement_items: z.array(
    z.object({
      variant_id: z.coerce.number().int().positive(),
      item_name: z.string().optional(),
      quantity: z.coerce.number().positive(),
      unit_price: z.coerce.number().min(0).optional(),
    })
  ).min(1, 'At least one replacement item must be selected'),
  price_difference: z.coerce.number().default(0),
  payment_mode: z.enum(['Cash', 'Card', 'UPI', 'Store Credit']).optional().default('Cash'),
  notes: z.string().optional(),
});

module.exports = {
  createPosReturnSchema,
  createPosExchangeSchema,
};
