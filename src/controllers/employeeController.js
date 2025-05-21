const { pool, poolConnect } = require('../config/database');

const employeeController = {
    // Get all employees
    getAllEmployees: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request().query('SELECT * FROM portalEmployees');
            res.json(result.recordset);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Get employee by ID
    getEmployeeById: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .query('SELECT * FROM portalEmployees WHERE id = @id');
            
            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'Employee not found' });
            }
            
            res.json(result.recordset[0]);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Create new employee
    createEmployee: async (req, res) => {
        try {
            const { name, email, phone, department } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('name', name)
                .input('email', email)
                .input('phone', phone)
                .input('department', department)
                .query(`
                    INSERT INTO portalEmployees (name, email, phone, department)
                    VALUES (@name, @email, @phone, @department);
                    SELECT SCOPE_IDENTITY() as id;
                `);
            
            res.status(201).json({ 
                id: result.recordset[0].id,
                message: 'Employee created successfully' 
            });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Update employee
    updateEmployee: async (req, res) => {
        try {
            const { name, email, phone, department } = req.body;
            
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .input('name', name)
                .input('email', email)
                .input('phone', phone)
                .input('department', department)
                .query(`
                    UPDATE portalEmployees 
                    SET name = @name,
                        email = @email,
                        phone = @phone,
                        department = @department,
                        updated_at = GETDATE()
                    WHERE id = @id
                `);
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Employee not found' });
            }
            
            res.json({ message: 'Employee updated successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    },

    // Delete employee
    deleteEmployee: async (req, res) => {
        try {
            await poolConnect;
            const result = await pool.request()
                .input('id', req.params.id)
                .query('DELETE FROM portalEmployees WHERE id = @id');
            
            if (result.rowsAffected[0] === 0) {
                return res.status(404).json({ message: 'Employee not found' });
            }
            
            res.json({ message: 'Employee deleted successfully' });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = employeeController; 