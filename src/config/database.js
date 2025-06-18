const sql = require('mssql');
const { SocksProxyAgent } = require('socks-proxy-agent');
require('dotenv').config();

// Log environment status
console.log('🔧 Database configuration starting...');
console.log('📊 Environment:', process.env.NODE_ENV || 'development');

// Database configuration
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true,
        connectTimeout: 30000, // 30 seconds
        requestTimeout: 30000  // 30 seconds
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Validate required environment variables
const requiredEnvVars = ['DB_USER', 'DB_PASSWORD', 'DB_SERVER', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars);
    console.error('⚠️ Please set these variables in your .env file or deployment environment');
    process.exit(1);
}

// Configure proxy if QUOTAGUARDSTATIC_URL is available
if (process.env.QUOTAGUARDSTATIC_URL) {
    try {
        console.log('🔄 Configuring QuotaGuard SOCKS proxy...');
        const agent = new SocksProxyAgent(process.env.QUOTAGUARDSTATIC_URL);
        dbConfig.connection = { agent };
        console.log('✅ QuotaGuard proxy configured successfully');
    } catch (error) {
        console.error('❌ Error configuring QuotaGuard proxy:', error.message);
        process.exit(1);
    }
} else {
    console.log('ℹ️ No proxy configuration found, using direct connection');
}

// Create connection pool
const pool = new sql.ConnectionPool(dbConfig);

// Export a function to get a connected pool
async function getConnectedPool() {
    if (!pool.connected && !pool.connecting) {
        try {
            console.log('🔄 Connecting to database...');
            await pool.connect();
            console.log('✅ Connected to database successfully');
        } catch (err) {
            console.error('❌ Database connection error:', err.message);
            throw err;
        }
    }
    return pool;
}

// Initial connection attempt
const poolConnect = getConnectedPool().catch(err => {
    console.error('❌ Initial database connection failed:', err.message);
    throw err;
});

// Handle pool errors
pool.on('error', err => {
    console.error('❌ Pool error:', err.message);
    if (err.code === 'ECONNRESET') {
        console.log('🔄 Attempting to reconnect...');
        getConnectedPool().catch(console.error);
    }
});

module.exports = {
    sql,
    pool,
    poolConnect,
    getConnectedPool
};
