const { getConnectedPool } = require('../../config/database');

const adminController = {
  // Get all users with their permissions
  getAllUsers: async (req, res) => {
    try {
      console.log('Admin getAllUsers called by user:', req.user.UserID);
      
      const pool = await getConnectedPool();
      
      // Get all users with their access permissions
      const result = await pool.request()
        .query(`
          SELECT 
            e.UserID,
            e.Name,
            e.Email,
            e.LastLogin,
            e.Status,
            a.AccessID,
            a.Contact,
            a.Company,
            a.AI,
            a.[File],
            a.Task,
            a.[Admin]
          FROM tenderEmployee e
          LEFT JOIN tenderAccess a ON e.UserID = a.UserID
          ORDER BY e.Name
        `);

      console.log('Found users:', result.recordset.length);

      // Transform the data to match frontend expectations
      const users = result.recordset.map(row => ({
        UserID: row.UserID,
        Name: row.Name,
        Email: row.Email,
        LastLogin: row.LastLogin,
        Status: row.Status,
        access: {
          AccessID: row.AccessID,
          UserID: row.UserID,
          Contact: row.Contact || false,
          Company: row.Company || false,
          AI: row.AI || false,
          File: row.File || false,
          Task: row.Task || false,
          Admin: row.Admin || false
        }
      }));

      res.json({ users });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to fetch users' 
      });
    }
  },

  // Add new user with permissions
  addUser: async (req, res) => {
    try {
      const { Name, Email } = req.body;

      // Validate required fields
      if (!Name || !Email) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Name and Email are required'
        });
      }

      const pool = await getConnectedPool();

      // Check if user already exists
      const existingUser = await pool.request()
        .input('Email', Email)
        .query('SELECT UserID FROM tenderEmployee WHERE Email = @Email');

      if (existingUser.recordset.length > 0) {
        return res.status(400).json({
          error: 'User already exists',
          message: 'A user with this email already exists'
        });
      }

      // Insert new user
      const userResult = await pool.request()
        .input('Name', Name)
        .input('Email', Email)
        .query(`
          INSERT INTO tenderEmployee (Name, Email, Status)
          OUTPUT INSERTED.UserID
          VALUES (@Name, @Email, 1)
        `);

      const userId = userResult.recordset[0].UserID;

      // Insert user permissions with defaults (everything enabled except Admin)
      await pool.request()
        .input('UserID', userId)
        .query(`
          INSERT INTO tenderAccess (UserID, Contact, Company, AI, [File], Task, [Admin])
          VALUES (@UserID, 1, 1, 1, 1, 1, 0)
        `);

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        userId
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create user'
      });
    }
  },

  // Update user and permissions
  updateUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const { Name, Email, Contact, Company, AI, File, Task, Admin } = req.body;

      // Validate required fields
      if (!Name || !Email) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Name and Email are required'
        });
      }

      const pool = await getConnectedPool();

      // Check if user exists
      const existingUser = await pool.request()
        .input('UserID', userId)
        .query('SELECT UserID FROM tenderEmployee WHERE UserID = @UserID');

      if (existingUser.recordset.length === 0) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User does not exist'
        });
      }

      // Check if email is already taken by another user
      const emailCheck = await pool.request()
        .input('Email', Email)
        .input('UserID', userId)
        .query('SELECT UserID FROM tenderEmployee WHERE Email = @Email AND UserID != @UserID');

      if (emailCheck.recordset.length > 0) {
        return res.status(400).json({
          error: 'Email already taken',
          message: 'This email is already used by another user'
        });
      }

      // Update user information
      await pool.request()
        .input('UserID', userId)
        .input('Name', Name)
        .input('Email', Email)
        .query(`
          UPDATE tenderEmployee 
          SET Name = @Name, Email = @Email
          WHERE UserID = @UserID
        `);

      // Update user permissions
      await pool.request()
        .input('UserID', userId)
        .input('Contact', Contact ? 1 : 0)
        .input('Company', Company ? 1 : 0)
        .input('AI', AI ? 1 : 0)
        .input('File', File ? 1 : 0)
        .input('Task', Task ? 1 : 0)
        .input('Admin', Admin ? 1 : 0)
        .query(`
          UPDATE tenderAccess 
          SET Contact = @Contact, Company = @Company, AI = @AI, [File] = @File, Task = @Task, [Admin] = @Admin
          WHERE UserID = @UserID
        `);

      res.json({
        success: true,
        message: 'User updated successfully'
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update user'
      });
    }
  },

  // Deactivate user and remove all permissions
  deleteUser: async (req, res) => {
    try {
      const { userId } = req.params;

      const pool = await getConnectedPool();

      // Check if user exists
      const existingUser = await pool.request()
        .input('UserID', userId)
        .query('SELECT UserID, Name, Email, Status FROM tenderEmployee WHERE UserID = @UserID');

      if (existingUser.recordset.length === 0) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User does not exist'
        });
      }

      const userToDeactivate = existingUser.recordset[0];

      // Check if user is already deactivated
      if (!userToDeactivate.Status) {
        return res.status(400).json({
          error: 'User already deactivated',
          message: 'This user is already deactivated'
        });
      }

      // Deactivate user (set Status = 0 and remove all permissions)
      await pool.request()
        .input('UserID', userId)
        .query(`
          UPDATE tenderEmployee 
          SET Status = 0 
          WHERE UserID = @UserID
        `);

      // Remove all permissions
      await pool.request()
        .input('UserID', userId)
        .query(`
          UPDATE tenderAccess 
          SET Contact = 0, Company = 0, AI = 0, [File] = 0, Task = 0, [Admin] = 0
          WHERE UserID = @UserID
        `);

      res.json({
        success: true,
        message: `User "${userToDeactivate.Name}" has been deactivated successfully`,
        deactivatedUser: {
          UserID: userToDeactivate.UserID,
          Name: userToDeactivate.Name,
          Email: userToDeactivate.Email,
          Status: false
        }
      });
    } catch (error) {
      console.error('Error deactivating user:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to deactivate user'
      });
    }
  },

  // Reactivate user and restore default permissions
  reactivateUser: async (req, res) => {
    try {
      const { userId } = req.params;

      const pool = await getConnectedPool();

      // Check if user exists
      const existingUser = await pool.request()
        .input('UserID', userId)
        .query('SELECT UserID, Name, Email, Status FROM tenderEmployee WHERE UserID = @UserID');

      if (existingUser.recordset.length === 0) {
        return res.status(404).json({
          error: 'User not found',
          message: 'User does not exist'
        });
      }

      const userToReactivate = existingUser.recordset[0];

      // Check if user is already active
      if (userToReactivate.Status) {
        return res.status(400).json({
          error: 'User already active',
          message: 'This user is already active'
        });
      }

      // Reactivate user (set Status = 1)
      await pool.request()
        .input('UserID', userId)
        .query(`
          UPDATE tenderEmployee 
          SET Status = 1 
          WHERE UserID = @UserID
        `);

      // Check if user has an access record
      const accessCheck = await pool.request()
        .input('UserID', userId)
        .query('SELECT AccessID FROM tenderAccess WHERE UserID = @UserID');

      if (accessCheck.recordset.length === 0) {
        // Create new access record with default permissions
        await pool.request()
          .input('UserID', userId)
          .query(`
            INSERT INTO tenderAccess (UserID, Contact, Company, AI, [File], Task, [Admin])
            VALUES (@UserID, 1, 1, 1, 1, 1, 0)
          `);
      } else {
        // Update existing access record with default permissions
        await pool.request()
          .input('UserID', userId)
          .query(`
            UPDATE tenderAccess 
            SET Contact = 1, Company = 1, AI = 1, [File] = 1, Task = 1, [Admin] = 0
            WHERE UserID = @UserID
          `);
      }

      res.json({
        success: true,
        message: `User "${userToReactivate.Name}" has been reactivated successfully`,
        reactivatedUser: {
          UserID: userToReactivate.UserID,
          Name: userToReactivate.Name,
          Email: userToReactivate.Email,
          Status: true
        }
      });
    } catch (error) {
      console.error('Error reactivating user:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to reactivate user'
      });
    }
  }
};

module.exports = adminController; 
 