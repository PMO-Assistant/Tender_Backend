const { pool, poolConnect } = require('../config/database');

class Employee {
    static async getAll() {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM Employees');
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
                .query('SELECT * FROM Employees WHERE id = @id');
            return result.recordset[0];
        } catch (err) {
            throw err;
        }
    }

    static async create(employee) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('firstName', employee.firstName)
                .input('lastName', employee.lastName)
                .input('email', employee.email)
                .input('phone', employee.phone)
                .input('department', employee.department)
                .input('position', employee.position)
                .input('hireDate', employee.hireDate)
                .query(`
                    INSERT INTO Employees (firstName, lastName, email, phone, department, position, hireDate)
                    VALUES (@firstName, @lastName, @email, @phone, @department, @position, @hireDate);
                    SELECT SCOPE_IDENTITY() as id;
                `);
            return result.recordset[0].id;
        } catch (err) {
            throw err;
        }
    }

    static async update(id, employee) {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', id)
                .input('firstName', employee.firstName)
                .input('lastName', employee.lastName)
                .input('email', employee.email)
                .input('phone', employee.phone)
                .input('department', employee.department)
                .input('position', employee.position)
                .input('hireDate', employee.hireDate)
                .input('status', employee.status)
                .query(`
                    UPDATE Employees 
                    SET firstName = @firstName,
                        lastName = @lastName,
                        email = @email,
                        phone = @phone,
                        department = @department,
                        position = @position,
                        hireDate = @hireDate,
                        status = @status,
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
                .query('DELETE FROM Employees WHERE id = @id');
            return result.rowsAffected[0] > 0;
        } catch (err) {
            throw err;
        }
    }
}

module.exports = Employee; 