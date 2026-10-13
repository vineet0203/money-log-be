const { z } = require('zod');

const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(100),
  slug: z.string().trim().max(120).optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  is_active: z.boolean().default(true),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name cannot be empty').max(100).optional(),
  slug: z.string().trim().max(120).optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  is_active: z.boolean().optional(),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
};
