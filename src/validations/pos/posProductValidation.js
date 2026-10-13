const { z } = require('zod');

const variantSchema = z.object({
  id: z.coerce.number().optional(), // Used in update
  sku: z.string().trim().max(100).optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  title: z.string().trim().min(1, 'Variant title is required').default('Default'),
  attributes: z.record(z.any()).default({}),
  cost_price: z.coerce.number().min(0, 'Cost price must be >= 0').default(0),
  mrp: z.coerce.number().min(0, 'MRP must be >= 0').default(0),
  selling_price: z.coerce.number().min(0, 'Selling price must be >= 0'),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
  stock_quantity: z.coerce.number().min(0, 'Stock quantity must be >= 0').default(0),
  min_stock_alert: z.coerce.number().min(0).default(5),
  is_active: z.boolean().default(true),
});

const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(255),
  category_id: z.coerce.number().nullable().optional(),
  brand_id: z.coerce.number().nullable().optional(),
  description: z.string().nullable().optional(),
  base_unit: z.string().trim().default('pcs'),
  is_taxable: z.boolean().default(true),
  tax_rate: z.coerce.number().min(0).max(100).nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
  image_url: z.string().trim().max(500).nullable().optional(),
  options_config: z.array(
    z.object({
      name: z.string().trim().min(1),
      values: z.array(z.string().trim().min(1)),
    })
  ).nullable().optional(),
  variants: z.array(variantSchema).min(1, 'At least one variant is required for every product'),
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name cannot be empty').max(255).optional(),
  category_id: z.coerce.number().nullable().optional(),
  brand_id: z.coerce.number().nullable().optional(),
  description: z.string().nullable().optional(),
  base_unit: z.string().trim().optional(),
  is_taxable: z.boolean().optional(),
  tax_rate: z.coerce.number().min(0).max(100).nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  image_url: z.string().trim().max(500).nullable().optional(),
  options_config: z.array(
    z.object({
      name: z.string().trim().min(1),
      values: z.array(z.string().trim().min(1)),
    })
  ).nullable().optional(),
  variants: z.array(variantSchema).min(1, 'At least one variant is required').optional(),
});

module.exports = {
  variantSchema,
  createProductSchema,
  updateProductSchema,
};
