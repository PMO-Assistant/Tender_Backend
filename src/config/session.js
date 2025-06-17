const session = require('express-session');
const MemoryStore = require('memorystore')(session);

// Try to get database connection, fallback to memory store if not available
let SQLStore;
let pool;

try {
    const dbConfig = require('./database');
    pool = dbConfig.pool;
    
    // Custom SQL store implementation
    SQLStore = class extends session.Store {
        constructor(options) {
            super(options);
            this.pool = options.pool;
        }

        async get(sid, callback) {
            try {
                const result = await this.pool.request()
                    .input('sid', sid)
                    .query('SELECT session FROM Sessions WHERE sid = @sid AND expires > GETDATE()');
                
                if (result.recordset.length > 0) {
                    callback(null, JSON.parse(result.recordset[0].session));
                } else {
                    callback(null, null);
                }
            } catch (err) {
                callback(err);
            }
        }

        async set(sid, session, callback) {
            try {
                await this.pool.request()
                    .input('sid', sid)
                    .input('session', JSON.stringify(session))
                    .input('expires', new Date(Date.now() + 24 * 60 * 60 * 1000))
                    .query(`
                        MERGE INTO Sessions AS target
                        USING (SELECT @sid AS sid) AS source
                        ON target.sid = source.sid
                        WHEN MATCHED THEN
                            UPDATE SET session = @session, expires = @expires
                        WHEN NOT MATCHED THEN
                            INSERT (sid, session, expires)
                            VALUES (@sid, @session, @expires);
                    `);
                if (callback) callback(null);
            } catch (err) {
                if (callback) callback(err);
            }
        }

        async destroy(sid, callback) {
            try {
                await this.pool.request()
                    .input('sid', sid)
                    .query('DELETE FROM Sessions WHERE sid = @sid');
                if (callback) callback(null);
            } catch (err) {
                if (callback) callback(err);
            }
        }

        async clear(callback) {
            try {
                await this.pool.request()
                    .query('DELETE FROM Sessions');
                if (callback) callback(null);
            } catch (err) {
                if (callback) callback(err);
            }
        }
    };
} catch (error) {
    console.log('Database connection not available, using memory store for sessions');
    SQLStore = null;
    pool = null;
}

// Choose store based on availability
const store = pool && SQLStore ? new SQLStore({ pool }) : new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
});

const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
};

module.exports = sessionConfig; 