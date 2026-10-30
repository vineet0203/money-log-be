require('dotenv').config();
const app = require('./src/app');
const cron = require('node-cron');
const { seedNotificationQueue } = require('./src/jobs/queue_seeder');
const { processNotificationQueue } = require('./src/jobs/queue_worker');

const PORT = process.env.PORT || 4001;

const { processRecurringJob } = require('./src/services/recurringService');

// Schedule Recurring Transactions Engine hourly at minute 5
cron.schedule('5 * * * *', () => {
  processRecurringJob();
});

// Schedule the Seeder to run every hour at minute 0
cron.schedule('0 * * * *', () => {
  seedNotificationQueue();
});

// Schedule the Worker to run every 5 minutes
cron.schedule('*/5 * * * *', () => {
  processNotificationQueue();
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Notification jobs scheduled.');
});
