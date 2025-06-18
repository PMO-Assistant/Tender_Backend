const sql = require('mssql');
const { SocksProxyAgent } = require('socks-proxy-agent');
require('dotenv').config();

const proxyUrl = process.env.QUOTAGUARDSTATIC_URL; // ex: socks5://user:pass@proxy.quotaguard.com:1080
const dbServer = process.env.DB_SERVER; // ex: adcocontracting.database.windows.net

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: dbServer,
    port: 1433,
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

// Criar agente SOCKS para o SQL Server
const agent = new SocksProxyAgent(proxyUrl);

// Sobrescreve o dialeto padrão para usar o agente
dbConfig.connection = { agent };

const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect()
    .then(() => {
        console.log('✅ Connected to Azure SQL via QuotaGuard SOCKS proxy');
        return pool;
    })
    .catch(err => {
        console.error('❌ SQL connection error:', err);
        throw err;
    });

module.exports = {
    sql,
    pool,
    poolConnect
};
