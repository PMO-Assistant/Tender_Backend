const sql = require('mssql');
const createTunnel = require('tunnel-ssh'); // 👈 Aqui é o fix!
const url = require('url');
require('dotenv').config();

const proxyUrl = process.env.QUOTAGUARDSTATIC_URL;
const parsed = url.parse(proxyUrl);
const [qgUser, qgPass] = parsed.auth.split(':');

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: '127.0.0.1',
    port: 14330,
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

const tunnelConfig = {
    username: qgUser,
    password: qgPass,
    host: parsed.hostname,
    port: 1080,
    dstHost: process.env.DB_SERVER,
    dstPort: 1433,
    localHost: '127.0.0.1',
    localPort: 14330,
    keepAlive: true,
    autoClose: false
};

let pool;
let poolConnect = new Promise((resolve, reject) => {
    createTunnel(tunnelConfig, (tunnelError, server) => {
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
