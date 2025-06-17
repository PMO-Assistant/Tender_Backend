require("dotenv").config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const sessionConfig = require('./config/session');

// ✅ Auth router and token middleware
const { authRouter, verifyToken } = require('./routes/auth');
const validateAdcoToken = require('./middleware/validateAdcoToken');

// ✅ Protected API routes
const eventRoutes = require('./routes/eventRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const assetRoutes = require('./routes/assetRoutes');
const quickLinkRoutes = require('./routes/quickLinkRoutes');
const subcontractorRoutes = require('./routes/subcontractorRoutes');
const calendarRoutes = require('./routes/calendarRoutes');
const erpTutorialRoutes = require('./routes/erpTutorials');
const safetyContentRoutes = require('./routes/safetyContent');
const autodeskTutorialRoutes = require('./routes/autodeskTutorials');

const app = express();

// Debug logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
    next();
});

// ✅ CORS setup
app.use(cors({
    origin: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'https://portal-frontend-git-main-adco-contractings-projects.vercel.app',
        'https://portal-frontend-adco-contractings-projects.vercel.app'
    ],
    credentials: true,
}));

// ✅ JSON parsing
app.use(express.json());

// ✅ Session middleware
app.use(session(sessionConfig));

// ✅ Public authentication routes
app.use('/api/auth', authRouter);

// ✅ Protected routes using ADCO token validation
app.use('/api/events', validateAdcoToken, eventRoutes);
app.use('/api/employees', validateAdcoToken, employeeRoutes);
app.use('/api/assets', validateAdcoToken, assetRoutes);
app.use('/api/quicklinks', validateAdcoToken, quickLinkRoutes);
app.use('/api/subcontractors', validateAdcoToken, subcontractorRoutes);
app.use('/api/calendar', validateAdcoToken, calendarRoutes);
app.use('/api/erp-tutorials', validateAdcoToken, erpTutorialRoutes);
app.use('/api/safety-content', validateAdcoToken, safetyContentRoutes);
app.use('/api/autodesk-tutorials', validateAdcoToken, autodeskTutorialRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        message: 'ADCO Backend API is running',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            auth: '/api/auth',
            events: '/api/events',
            employees: '/api/employees',
            assets: '/api/assets',
            quicklinks: '/api/quicklinks',
            subcontractors: '/api/subcontractors',
            calendar: '/api/calendar',
            erpTutorials: '/api/erp-tutorials',
            safetyContent: '/api/safety-content',
            autodeskTutorials: '/api/autodesk-tutorials'
        }
    });
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
