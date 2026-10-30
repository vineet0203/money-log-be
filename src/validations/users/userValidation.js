const { z } = require('zod');

const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().max(100, 'Name must be 100 characters or less').optional(),
    phone_number: z.string().trim().max(25).or(z.literal('')).nullable().optional(),
    phone: z.string().trim().max(25).or(z.literal('')).nullable().optional(),
    timezone: z.string().max(100, 'Timezone must be 100 characters or less').optional(),
    remove_profile_image: z.union([z.boolean(), z.string()]).optional(),
    global_sms_enabled: z.union([z.boolean(), z.string(), z.number()]).optional(),
    global_email_enabled: z.union([z.boolean(), z.string(), z.number()]).optional(),
    global_push_enabled: z.union([z.boolean(), z.string(), z.number()]).optional(),
  })
});

const pushTokenSchema = z.object({
  body: z.object({
    token: z.string({ required_error: 'Token is required' }).min(1, 'Token cannot be empty')
  })
});

module.exports = {
  updateProfileSchema,
  pushTokenSchema
};
