const { z } = require('zod');

// Schema for creating a transaction (§5.2)
const createTransactionSchema = z.object({
  body: z.object({
    title: z.string({ required_error: 'Title is required' }).trim().min(1, 'Title cannot be empty').max(255),
    amount: z.coerce
      .number({ required_error: 'Amount is required' })
      .positive('Amount must be greater than 0')
      .refine(
        (val) => Number(val.toFixed(2)) === val,
        'Amount cannot have more than 2 decimal places'
      ),
    type: z.enum(['expense', 'income'], {
      required_error: 'Transaction type must be expense or income',
    }),
    date: z.string({ required_error: 'Date is required' }).regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be a valid YYYY-MM-DD date'),
    category_id: z.coerce.number().positive().nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    subscription_id: z.coerce.number().positive().nullable().optional(),
  })
});

// Schema for updating a transaction (§1.2, §5.2)
const updateTransactionSchema = z.object({
  params: z.object({
    id: z.coerce.number().positive('Invalid transaction ID')
  }),
  body: z.object({
    title: z.string().trim().min(1).max(255).optional(),
    subtitle: z.string().max(255).nullable().optional(),
    amount: z.coerce
      .number()
      .positive('Amount must be greater than 0')
      .refine(
        (val) => Number(val.toFixed(2)) === val,
        'Amount cannot have more than 2 decimal places'
      )
      .optional(),
    type: z.enum(['expense', 'income']).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Date must be a valid YYYY-MM-DD date').optional(),
    category_id: z.coerce.number().positive().nullable().optional().or(z.literal('')),
    description: z.string().max(1000).nullable().optional(),
    remove_receipt: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  })
});

// Schema for transaction ID param
const transactionIdParamSchema = z.object({
  params: z.object({
    id: z.coerce.number().positive('Invalid transaction ID')
  })
});

// Schema for querying transactions list
const listTransactionsQuerySchema = z.object({
  query: z.object({
    type: z.enum(['expense', 'income', 'all']).optional(),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
    category_id: z.coerce.number().positive().optional(),
    search: z.string().max(100).optional(),
    has_receipt: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
    offset: z.coerce.number().min(0).optional(),
    page: z.coerce.number().min(1).optional(),
  })
});

module.exports = {
  createTransactionSchema,
  updateTransactionSchema,
  transactionIdParamSchema,
  listTransactionsQuerySchema,
};
