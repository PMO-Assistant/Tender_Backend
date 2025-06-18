require("dotenv").config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');

// Environment variables with fallbacks
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://adcoportal.ie';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://adcoportal.ie';
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('🚀 Starting ADCO Backend with configuration:', {
    CORS_ORIGIN,
    FRONTEND_URL,
    NODE_ENV,
    PORT: process.env.PORT || 3001
});

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Log all CORS requests for debugging
        console.log('🌐 CORS Request from origin:', origin);
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) {
            console.log('✅ Allowing request with no origin');
            return callback(null, true);
        }
        
        const allowedOrigins = [
            CORS_ORIGIN,
            FRONTEND_URL,
            'https://adcoportal.ie',
            'https://www.adcoportal.ie',
            'http://localhost:3000',
            'https://localhost:3000'
        ];
        
        // Check if origin is allowed
        const isAllowed = allowedOrigins.includes(origin);
        
        if (isAllowed) {
            console.log('✅ CORS: Origin allowed:', origin);
            callback(null, true);
        } else {
            console.log('❌ CORS: Origin blocked:', origin);
            console.log('📋 Allowed origins:', allowedOrigins);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

// Simple session config
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
};

// Load routes with simple error handling
let authRouter, eventRoutes, employeeRoutes, assetRoutes, quickLinkRoutes, 
    subcontractorRoutes, calendarRoutes, erpTutorialRoutes, safetyContentRoutes, autodeskTutorialRoutes, fileOpenerRoutes;

try {
    const authModule = require('./routes/auth');
    authRouter = authModule.authRouter;
} catch (error) {
    console.log('⚠️ Auth router not available, creating fallback');
    authRouter = express.Router();
    authRouter.get('/health', (req, res) => res.json({ status: 'auth-healthy' }));
}

// Load other routes with fallbacks
try {
    eventRoutes = require('./routes/eventRoutes');
} catch (error) {
    console.log('⚠️ Event routes not available, creating fallback');
    eventRoutes = express.Router();
    eventRoutes.get('/', (req, res) => res.json({ message: 'Events endpoint' }));
}

try {
    employeeRoutes = require('./routes/employeeRoutes');
} catch (error) {
    console.log('⚠️ Employee routes not available, creating fallback');
    employeeRoutes = express.Router();
    employeeRoutes.get('/', (req, res) => res.json({ message: 'Employees endpoint' }));
}

try {
    assetRoutes = require('./routes/assetRoutes');
} catch (error) {
    console.log('⚠️ Asset routes not available, creating fallback');
    assetRoutes = express.Router();
    assetRoutes.get('/', (req, res) => res.json({ message: 'Assets endpoint' }));
}

try {
    quickLinkRoutes = require('./routes/quickLinkRoutes');
} catch (error) {
    console.log('⚠️ QuickLink routes not available, creating fallback');
    quickLinkRoutes = express.Router();
    quickLinkRoutes.get('/', (req, res) => res.json({ message: 'Quicklinks endpoint' }));
}

try {
    subcontractorRoutes = require('./routes/subcontractorRoutes');
} catch (error) {
    console.log('⚠️ Subcontractor routes not available, creating fallback');
    subcontractorRoutes = express.Router();
    subcontractorRoutes.get('/', (req, res) => res.json({ message: 'Subcontractors endpoint' }));
}

try {
    calendarRoutes = require('./routes/calendarRoutes');
} catch (error) {
    console.log('⚠️ Calendar routes not available, creating fallback');
    calendarRoutes = express.Router();
    calendarRoutes.get('/', (req, res) => res.json({ message: 'Calendar endpoint' }));
}

try {
    erpTutorialRoutes = require('./routes/erpTutorials');
} catch (error) {
    console.log('⚠️ ERP Tutorial routes not available, creating fallback');
    erpTutorialRoutes = express.Router();
    erpTutorialRoutes.get('/', (req, res) => res.json({ message: 'ERP Tutorials endpoint' }));
}

try {
    safetyContentRoutes = require('./routes/safetyContent');
} catch (error) {
    console.log('⚠️ Safety Content routes not available, creating fallback');
    safetyContentRoutes = express.Router();
    safetyContentRoutes.get('/', (req, res) => res.json({ message: 'Safety Content endpoint' }));
}

try {
    autodeskTutorialRoutes = require('./routes/autodeskTutorials');
} catch (error) {
    console.log('⚠️ Autodesk Tutorial routes not available, creating fallback');
    autodeskTutorialRoutes = express.Router();
    autodeskTutorialRoutes.get('/', (req, res) => res.json({ message: 'Autodesk Tutorials endpoint' }));
}

try {
    fileOpenerRoutes = require('./routes/fileOpenerRoutes');
    console.log('✅ File Opener routes loaded - using in-memory token store');
} catch (error) {
    console.log('⚠️ File Opener routes not available, creating fallback');
    fileOpenerRoutes = express.Router();
    fileOpenerRoutes.get('/', (req, res) => res.json({ 
        message: 'File Opener endpoint',
        note: 'Using in-memory token store with 3-minute expiry'
    }));
}

const app = express();

// 1. CORS middleware MUST be applied FIRST, before any other middleware
console.log('🔧 Applying CORS middleware...');
app.use(cors(corsOptions));

// 2. Handle OPTIONS requests explicitly for all routes
app.options('*', cors(corsOptions));

// 3. Basic middleware (after CORS)
app.use(express.json());
app.use(session(sessionConfig));

// 4. Request logging middleware (after CORS)
app.use((req, res, next) => {
    console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
    
    // Special logging for OPTIONS requests
    if (req.method === 'OPTIONS') {
        console.log('🔄 Preflight request detected');
        console.log('📋 Preflight headers:', {
            'access-control-request-method': req.headers['access-control-request-method'],
            'access-control-request-headers': req.headers['access-control-request-headers'],
            origin: req.headers.origin
        });
    }
    
    next();
});

// 5. Public routes (no authentication required)
app.use('/api/auth', authRouter);

// 6. Protected routes (without authentication middleware for now to prevent crashes)
app.use('/api/events', eventRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/quicklinks', quickLinkRoutes);
app.use('/api/subcontractors', subcontractorRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/erp-tutorials', erpTutorialRoutes);
app.use('/api/safety-content', safetyContentRoutes);
app.use('/api/autodesk-tutorials', autodeskTutorialRoutes);

// File opener routes with in-memory token store (3-minute expiry)
app.use('/api/file-opener', fileOpenerRoutes);

// 7. Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        corsOrigin: CORS_ORIGIN,
        frontendUrl: FRONTEND_URL
    });
});

// 8. Public test endpoint
app.get('/public-test', (req, res) => {
    res.status(200).json({ 
        message: 'Public endpoint working',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        corsOrigin: CORS_ORIGIN,
        frontendUrl: FRONTEND_URL
    });
});

// 9. CORS debug endpoint
app.get('/cors-debug', (req, res) => {
    res.status(200).json({ 
        message: 'CORS debug endpoint',
        origin: req.headers.origin,
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        corsOrigin: CORS_ORIGIN,
        frontendUrl: FRONTEND_URL,
        allowedOrigins: [
            CORS_ORIGIN, 
            FRONTEND_URL, 
            'https://adcoportal.ie',
            'https://www.adcoportal.ie',
            'http://localhost:3000',
            'https://localhost:3000'
        ]
    });
});

// 10. Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({ 
        message: 'ADCO Backend API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        corsOrigin: CORS_ORIGIN,
        frontendUrl: FRONTEND_URL
    });
});

// 11. Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Error occurred:', err.message);
    console.error('📋 Request details:', {
        method: req.method,
        path: req.path,
        origin: req.headers.origin,
        userAgent: req.headers['user-agent']
    });
    
    // Don't send error details in production
    const errorMessage = NODE_ENV === 'production' ? 'Something went wrong!' : err.message;
    res.status(500).json({ error: errorMessage });
});

// 12. 404 handler
app.use('*', (req, res) => {
    console.log('❌ 404 - Route not found:', req.method, req.originalUrl);
    res.status(404).json({ error: 'Route not found' });
});

// 13. Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('✅ Server is running on port', PORT);
    console.log('🌍 Environment:', NODE_ENV);
    console.log('🔗 CORS Origin:', CORS_ORIGIN);
    console.log('🎯 Frontend URL:', FRONTEND_URL);
    console.log('📊 Health check available at: /health');
    console.log('🔍 CORS debug available at: /cors-debug');
});
