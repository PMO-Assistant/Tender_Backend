const { pool, poolConnect } = require('../config/database');

class Asset {
    static async getAll() {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM Assets');
            return result.recordset;
        } catch (err) {
            throw err;
        }
    }

    static async getById(id) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', id)
                .query('SELECT * FROM Assets WHERE id = @id');
            return result.recordset[0];
        } catch (err) {
            throw err;
        }
    }

    static async create(asset) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', asset.id)
                .input('name', asset.name)
                .input('type', asset.type)
                .input('location', asset.location)
                .input('status', asset.status)
                .input('quantity', asset.quantity)
                .query(`
                    INSERT INTO Assets (id, name, type, location, status, quantity)
                    VALUES (@id, @name, @type, @location, @status, @quantity)
                `);
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }

    static async update(id, asset) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', id)
                .input('name', asset.name)
                .input('type', asset.type)
                .input('location', asset.location)
                .input('status', asset.status)
                .input('quantity', asset.quantity)
                .query(`
                    UPDATE Assets 
                    SET name = @name,
                        type = @type,
                        location = @location,
                        status = @status,
                        quantity = @quantity,
                        updated_at = GETDATE()
                    WHERE id = @id
                `);
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }

    static async delete(id) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', id)
                .query('DELETE FROM Assets WHERE id = @id');
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }
}

module.exports = Asset; 