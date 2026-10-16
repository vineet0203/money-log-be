const { z } = require('zod');

const listNotificationsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    unread_only: z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).optional(),
  }),
});

const notificationIdParamSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive('Invalid notification ID'),
  }),
});

module.exports = {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
};
