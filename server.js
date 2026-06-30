require('dotenv').config();
const app = require('./src/app');
const cron = require('node-cron');
const { seedNotificationQueue } = require('./src/jobs/queue_seeder');
const { processNotificationQueue } = require('./src/jobs/queue_worker');

const PORT = process.env.PORT || 5000;

// Schedule the Seeder to run every hour at minute 0
cron.schedule('0 * * * *', () => {
  seedNotificationQueue();
});

// Schedule the Worker to run every 5 minutes
cron.schedule('*/5 * * * *', () => {
  processNotificationQueue();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Notification jobs scheduled.');
});
