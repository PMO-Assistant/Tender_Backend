require("dotenv").config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const sessionConfig = require('./config/session');

// ✅ Auth router and token middleware
const { authRouter, verifyToken } = require('./routes/auth');

// ✅ Protected API routes
const eventRoutes = require('./routes/eventRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const assetRoutes = require('./routes/assetRoutes');
const quickLinkRoutes = require('./routes/quickLinkRoutes');
const subcontractorRoutes = require('./routes/subcontractorRoutes');
const calendarRoutes = require('./routes/calendarRoutes');

const app = express();

// ✅ CORS setup
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));

// ✅ JSON parsing
app.use(express.json());

// ✅ Session middleware
app.use(session(sessionConfig));

// ✅ Public authentication routes
app.use('/api/auth', authRouter);

// ✅ Protected routes using session auth
app.use('/api/events', eventRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/quicklinks', quickLinkRoutes);
app.use('/api/subcontractors', subcontractorRoutes);
app.use('/api/calendar', calendarRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// ✅ Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
