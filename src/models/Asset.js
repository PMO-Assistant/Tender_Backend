const { pool, poolConnect } = require('../config/database');

class Asset {
    static async getAll() {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM portalAssets');
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
                .query('SELECT * FROM portalAssets WHERE id = @id');
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
                .input('owner', asset.owner)
                .input('comments', asset.comments)
                .query(`
                    INSERT INTO portalAssets (id, name, type, location, status, quantity, owner, comments)
                    VALUES (@id, @name, @type, @location, @status, @quantity, @owner, @comments)
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
                .input('owner', asset.owner)
                .input('comments', asset.comments)
                .query(`
                    UPDATE portalAssets 
                    SET name = @name,
                        type = @type,
                        location = @location,
                        status = @status,
                        quantity = @quantity,
                        owner = @owner,
                        comments = @comments,
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
                .query('DELETE FROM portalAssets WHERE id = @id');
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }
}

module.exports = Asset; 