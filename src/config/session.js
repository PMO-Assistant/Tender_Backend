const session = require('express-session');
const { pool } = require('./database');

// Custom SQL store implementation
class SQLStore extends session.Store {
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
}

const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: new SQLStore({ pool }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
};

module.exports = sessionConfig; 