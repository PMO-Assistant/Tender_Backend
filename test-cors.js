// Simple CORS test script
const express = require('express');
const cors = require('cors');

const app = express();

// CORS configuration matching your main app
app.use(cors({
    origin: function (origin, callback) {
        console.log('CORS Request from origin:', origin);
        
        if (!origin) {
            console.log('Allowing request with no origin');
            return callback(null, true);
        }
        
        const allowedOrigins = [
            'http://localhost:3000',
            'https://adcoportal.ie',
            'https://www.adcoportal.ie',
            /^https:\/\/.*\.vercel\.app$/,
            /^https:\/\/.*\.vercel\.com$/,
        ];
        
        const isAllowed = allowedOrigins.some(allowedOrigin => {
            if (typeof allowedOrigin === 'string') {
                return origin === allowedOrigin;
            } else if (allowedOrigin instanceof RegExp) {
                return allowedOrigin.test(origin);
            }
            return false;
        });
        
        if (isAllowed) {
            console.log('CORS: Origin allowed:', origin);
            callback(null, true);
        } else {
            console.log('CORS: Origin blocked:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
}));

app.get('/test', (req, res) => {
    res.json({ 
        message: 'CORS test successful',
        origin: req.headers.origin,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        cors: 'enabled',
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`CORS test server running on port ${PORT}`);
    console.log(`Test endpoint: http://localhost:${PORT}/test`);
    console.log(`Health endpoint: http://localhost:${PORT}/health`);
}); 
 
 
 