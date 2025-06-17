require("dotenv").config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');

// Simple session config
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
};

// Load routes with simple error handling
let authRouter, eventRoutes, employeeRoutes, assetRoutes, quickLinkRoutes, 
    subcontractorRoutes, calendarRoutes, erpTutorialRoutes, safetyContentRoutes, autodeskTutorialRoutes;

try {
    const authModule = require('./routes/auth');
    authRouter = authModule.authRouter;
} catch (error) {
    console.log('Auth router not available, creating fallback');
    authRouter = express.Router();
    authRouter.get('/health', (req, res) => res.json({ status: 'auth-healthy' }));
}

// Load other routes with fallbacks
try {
    eventRoutes = require('./routes/eventRoutes');
} catch (error) {
    eventRoutes = express.Router();
    eventRoutes.get('/', (req, res) => res.json({ message: 'Events endpoint' }));
}

try {
    employeeRoutes = require('./routes/employeeRoutes');
} catch (error) {
    employeeRoutes = express.Router();
    employeeRoutes.get('/', (req, res) => res.json({ message: 'Employees endpoint' }));
}

try {
    assetRoutes = require('./routes/assetRoutes');
} catch (error) {
    assetRoutes = express.Router();
    assetRoutes.get('/', (req, res) => res.json({ message: 'Assets endpoint' }));
}

try {
    quickLinkRoutes = require('./routes/quickLinkRoutes');
} catch (error) {
    quickLinkRoutes = express.Router();
    quickLinkRoutes.get('/', (req, res) => res.json({ message: 'Quicklinks endpoint' }));
}

try {
    subcontractorRoutes = require('./routes/subcontractorRoutes');
} catch (error) {
    subcontractorRoutes = express.Router();
    subcontractorRoutes.get('/', (req, res) => res.json({ message: 'Subcontractors endpoint' }));
}

try {
    calendarRoutes = require('./routes/calendarRoutes');
} catch (error) {
    calendarRoutes = express.Router();
    calendarRoutes.get('/', (req, res) => res.json({ message: 'Calendar endpoint' }));
}

try {
    erpTutorialRoutes = require('./routes/erpTutorials');
} catch (error) {
    erpTutorialRoutes = express.Router();
    erpTutorialRoutes.get('/', (req, res) => res.json({ message: 'ERP Tutorials endpoint' }));
}

try {
    safetyContentRoutes = require('./routes/safetyContent');
} catch (error) {
    safetyContentRoutes = express.Router();
    safetyContentRoutes.get('/', (req, res) => res.json({ message: 'Safety Content endpoint' }));
}

try {
    autodeskTutorialRoutes = require('./routes/autodeskTutorials');
} catch (error) {
    autodeskTutorialRoutes = express.Router();
    autodeskTutorialRoutes.get('/', (req, res) => res.json({ message: 'Autodesk Tutorials endpoint' }));
}

const app = express();

// Simple CORS setup
app.use(cors({
    origin: [
        process.env.CORS_ORIGIN || 'https://adcoportal.ie',
        process.env.FRONTEND_URL || 'https://adcoportal.ie',
        'http://localhost:3000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));

// Handle OPTIONS requests
app.options('*', (req, res) => {
    res.status(200).end();
});

// Basic middleware
app.use(express.json());
app.use(session(sessionConfig));

// Simple request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Public routes
app.use('/api/auth', authRouter);

// Protected routes (without middleware for now)
app.use('/api/events', eventRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/quicklinks', quickLinkRoutes);
app.use('/api/subcontractors', subcontractorRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/erp-tutorials', erpTutorialRoutes);
app.use('/api/safety-content', safetyContentRoutes);
app.use('/api/autodesk-tutorials', autodeskTutorialRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Public test endpoint
app.get('/public-test', (req, res) => {
    res.status(200).json({ 
        message: 'Public endpoint working',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// CORS debug endpoint
app.get('/cors-debug', (req, res) => {
    res.status(200).json({ 
        message: 'CORS debug endpoint',
        origin: req.headers.origin,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        corsOrigin: process.env.CORS_ORIGIN,
        frontendUrl: process.env.FRONTEND_URL
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        message: 'ADCO Backend API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Simple error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
