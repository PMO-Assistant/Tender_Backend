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
                .input('responsible', asset.responsible)
                .input('purchaseDate', asset.purchaseDate)
                .input('finishDate', asset.finishDate)
                .input('scanFrequency', asset.scanFrequency)
                .query(`
                    INSERT INTO portalAssets (id, name, type, location, status, quantity, owner, comments, Responsible, Purchase_Date, Finish_Date, ScanFrequency, Last_Updated)
                    VALUES (@id, @name, @type, @location, @status, @quantity, @owner, @comments, @responsible, @purchaseDate, @finishDate, @scanFrequency, GETDATE())
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
                .input('responsible', asset.responsible)
                .input('purchaseDate', asset.purchaseDate)
                .input('finishDate', asset.finishDate)
                .input('scanFrequency', asset.scanFrequency)
                .query(`
                    UPDATE portalAssets 
                    SET name = @name,
                        type = @type,
                        location = @location,
                        status = @status,
                        quantity = @quantity,
                        owner = @owner,
                        comments = @comments,
                        Responsible = @responsible,
                        Purchase_Date = @purchaseDate,
                        Finish_Date = @finishDate,
                        ScanFrequency = @scanFrequency,
                        Last_Updated = GETDATE()
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