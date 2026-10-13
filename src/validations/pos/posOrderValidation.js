const { z } = require('zod');

const orderItemSchema = z.object({
  variant_id: z.coerce.number().positive('Valid variant ID is required'),
  item_name: z.string().trim().min(1, 'Item name is required'),
  sku: z.string().trim().default('SKU-GEN'),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  unit_price: z.coerce.number().min(0, 'Unit price must be >= 0'),
  unit_cost: z.coerce.number().min(0).default(0),
  discount_amount: z.coerce.number().min(0).default(0),
  tax_amount: z.coerce.number().min(0).default(0),
  total_amount: z.coerce.number().min(0, 'Total amount must be >= 0'),
});

const createOrderSchema = z.object({
  customer_name: z.string().trim().max(150).default('Walk-in Customer'),
  customer_phone: z.string().trim().max(30).nullable().optional(),
  register_label: z.string().trim().max(50).default('Terminal #01'),
  subtotal: z.coerce.number().min(0, 'Subtotal must be >= 0'),
  discount_total: z.coerce.number().min(0).default(0),
  tax_total: z.coerce.number().min(0).default(0),
  grand_total: z.coerce.number().min(0, 'Grand total must be >= 0'),
  notes: z.string().trim().nullable().optional(),
  payment_mode: z.enum(['Cash', 'Card', 'UPI', 'Bank Transfer', 'Store Credit']).default('Cash'),
  payment_amount: z.coerce.number().min(0).optional(),
  payment_reference: z.string().trim().max(100).nullable().optional(),
  receipt_config: z.record(z.any()).optional(),
  items: z.array(orderItemSchema).min(1, 'At least one item is required in the sale order'),
});

module.exports = {
  createOrderSchema,
  orderItemSchema,
};
