const { getConnectedPool } = require('../../config/database');

const userController = {
    // Get user by ID
    getUserById: async (req, res) => {
        try {
            const { userId } = req.params;
            const pool = await getConnectedPool();
            
            const result = await pool.request()
                .input('UserID', userId)
                .query(`
                    SELECT 
                        UserID,
                        Name,
                        Email,
                        Status
                    FROM tenderEmployee 
                    WHERE UserID = @UserID AND Status = 1
                `);

            if (result.recordset.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            const user = result.recordset[0];
            res.json({
                userId: user.UserID,
                name: user.Name,
                email: user.Email,
                status: user.Status,
                fullName: user.Name
            });
        } catch (err) {
            console.error('Error getting user by ID:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get multiple users by IDs
    getUsersByIds: async (req, res) => {
        try {
            const { userIds } = req.body;
            
            if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
                return res.status(400).json({ message: 'User IDs array is required' });
            }

            const pool = await getConnectedPool();
            
            // Create a comma-separated list of user IDs for the IN clause
            const userIdList = userIds.map((_, index) => `@UserID${index}`).join(',');
            
            const request = pool.request();
            userIds.forEach((userId, index) => {
                request.input(`UserID${index}`, userId);
            });
            
            const result = await request.query(`
                SELECT 
                    UserID,
                    Name,
                    Email,
                    Status
                FROM tenderEmployee 
                WHERE UserID IN (${userIdList}) AND Status = 1
            `);

            const users = result.recordset.map(user => ({
                userId: user.UserID,
                name: user.Name,
                email: user.Email,
                status: user.Status,
                fullName: user.Name
            }));

            res.json(users);
        } catch (err) {
            console.error('Error getting users by IDs:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get all active users (for dropdowns, etc.)
    getAllActiveUsers: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            const result = await pool.request()
                .query(`
                    SELECT 
                        UserID,
                        Name,
                        Email,
                        Status
                    FROM tenderEmployee 
                    WHERE Status = 1
                    ORDER BY Name
                `);

            const users = result.recordset.map(user => ({
                userId: user.UserID,
                name: user.Name,
                email: user.Email,
                status: user.Status,
                fullName: user.Name
            }));

            res.json(users);
        } catch (err) {
            console.error('Error getting all active users:', err);
            res.status(500).json({ message: err.message });
        }
    },

    // Get all active users with new format for tenders list (UserID, Name, Email, Status)
    getAllActiveUsersNewFormat: async (req, res) => {
        try {
            const pool = await getConnectedPool();
            
            const result = await pool.request()
                .query(`
                    SELECT 
                        UserID,
                        Name,
                        Email,
                        Status
                    FROM tenderEmployee 
                    WHERE Status = 1
                    ORDER BY Name
                `);

            const users = result.recordset.map(user => ({
                UserID: user.UserID,
                Name: user.Name,
                Email: user.Email,
                Status: user.Status
            }));

            res.json(users);
        } catch (err) {
            console.error('Error getting all active users (new format):', err);
            res.status(500).json({ message: err.message });
        }
    }
};

module.exports = userController; 