const sql = require('mssql');
const tunnel = require('tunnel-ssh').default || require('tunnel-ssh');

const url = require('url');
require('dotenv').config();

const proxyUrl = process.env.QUOTAGUARDSTATIC_URL;
const parsed = url.parse(proxyUrl);
const [qgUser, qgPass] = parsed.auth.split(':');

// Your Azure SQL config
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: '127.0.0.1', // Will tunnel to actual server
    port: 14330, // Local tunnel port
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: false
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Tunnel config
const tunnelConfig = {
    username: qgUser,
    password: qgPass,
    host: parsed.hostname,
    port: 1080, // SOCKS proxy
    dstHost: process.env.DB_SERVER, // e.g., adcocontracting.database.windows.net
    dstPort: 1433,
    localHost: '127.0.0.1',
    localPort: 14330,
    keepAlive: true
};

let pool;
let poolConnect = new Promise((resolve, reject) => {
    tunnel(tunnelConfig, (tunnelError, server) => {
        if (tunnelError) {
            console.error('❌ SSH tunnel error:', tunnelError);
            return reject(tunnelError);
        }

        pool = new sql.ConnectionPool(dbConfig);
        pool.connect()
            .then(() => {
                console.log('✅ Connected to Azure SQL via Quotaguard');
                resolve(pool);
            })
            .catch(sqlError => {
                console.error('❌ SQL connection error:', sqlError);
                reject(sqlError);
            });
    });
});

module.exports = {
    pool,
    poolConnect,
    sql
};
