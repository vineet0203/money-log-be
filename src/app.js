const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/authRoutes');
const accountsRoutes = require('./routes/accountRoutes');
const subscriptionsRoutes = require('./routes/subscriptionRoutes');
const categoriesRoutes = require('./routes/categoryRoutes');
const transactionsRoutes = require('./routes/transactionRoutes');
const reportsRoutes = require('./routes/reportRoutes');
const usersRoutes = require('./routes/userRoutes');
const notificationsRoutes = require('./routes/notificationRoutes');
const plaidRoutes = require('./routes/plaidRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const morgan = require('morgan');

const app = express();

// Trust the first proxy to allow express-rate-limit to read X-Forwarded-For
app.set('trust proxy', 1);

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/plaid', plaidRoutes);
app.use('/api/webhook', webhookRoutes);

// Serve uploads statically
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to money-log API' });
});

module.exports = app;
