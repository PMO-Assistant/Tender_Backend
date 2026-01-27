const { getConnectedPool } = require('../../config/database');

const bdController = {
  // GET /api/bd - Get all BD entries
  getAllBD: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      const result = await pool.request()
        .input('UserID', userId)
        .query(`
          SELECT 
            b.BDID,
            b.Description,
            b.Date,
            b.CreatedBy,
            b.LastUpdated,
            b.MeetingLink,
            e.Name as CreatedByName,
            e.Email as CreatedByEmail
          FROM tenderBD b
          LEFT JOIN tenderEmployee e ON b.CreatedBy = e.UserID
          ORDER BY b.Date DESC, b.BDID DESC
        `);

      const bdEntries = result.recordset.map(entry => ({
        id: entry.BDID,
        description: entry.Description,
        date: entry.Date ? new Date(entry.Date).toISOString().split('T')[0] : null,
        createdBy: entry.CreatedBy,
        createdByName: entry.CreatedByName,
        createdByEmail: entry.CreatedByEmail,
        lastUpdated: entry.LastUpdated ? new Date(entry.LastUpdated).toISOString() : null,
        meetingLink: entry.MeetingLink
      }));

      res.json({
        success: true,
        entries: bdEntries
      });
    } catch (error) {
      console.error('Error fetching BD entries:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch BD entries',
        message: error.message
      });
    }
  },

  // GET /api/bd/:id - Get a single BD entry
  getBDById: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await getConnectedPool();

      const result = await pool.request()
        .input('BDID', id)
        .query(`
          SELECT 
            b.BDID,
            b.Description,
            b.Date,
            b.CreatedBy,
            b.LastUpdated,
            b.MeetingLink,
            e.Name as CreatedByName,
            e.Email as CreatedByEmail
          FROM tenderBD b
          LEFT JOIN tenderEmployee e ON b.CreatedBy = e.UserID
          WHERE b.BDID = @BDID
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'BD entry not found'
        });
      }

      const entry = result.recordset[0];
      res.json({
        success: true,
        entry: {
          id: entry.BDID,
          description: entry.Description,
          date: entry.Date ? new Date(entry.Date).toISOString().split('T')[0] : null,
          createdBy: entry.CreatedBy,
          createdByName: entry.CreatedByName,
          createdByEmail: entry.CreatedByEmail,
          lastUpdated: entry.LastUpdated ? new Date(entry.LastUpdated).toISOString() : null,
          meetingLink: entry.MeetingLink
        }
      });
    } catch (error) {
      console.error('Error fetching BD entry:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch BD entry',
        message: error.message
      });
    }
  },

  // POST /api/bd - Create a new BD entry
  createBD: async (req, res) => {
    try {
      const { Description, Date, MeetingLink } = req.body;

      if (!Description || !Date) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          message: 'Description and Date are required'
        });
      }

      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      const result = await pool.request()
        .input('Description', Description)
        .input('Date', Date)
        .input('CreatedBy', userId)
        .input('MeetingLink', MeetingLink || null)
        .query(`
          INSERT INTO tenderBD (Description, Date, CreatedBy, MeetingLink)
          OUTPUT INSERTED.BDID
          VALUES (@Description, @Date, @CreatedBy, @MeetingLink)
        `);

      const bdId = result.recordset[0].BDID;

      res.status(201).json({
        success: true,
        message: 'BD entry created successfully',
        id: bdId
      });
    } catch (error) {
      console.error('Error creating BD entry:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create BD entry',
        message: error.message
      });
    }
  },

  // PUT /api/bd/:id - Update a BD entry
  updateBD: async (req, res) => {
    try {
      const { id } = req.params;
      const { Description, Date, MeetingLink } = req.body;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Check if BD entry exists and user has permission (creator or admin)
      const checkResult = await pool.request()
        .input('BDID', id)
        .input('UserID', userId)
        .query(`
          SELECT CreatedBy FROM tenderBD WHERE BDID = @BDID
        `);

      if (checkResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'BD entry not found'
        });
      }

      // Check if user is the creator (for now, only creator can edit)
      const createdBy = checkResult.recordset[0].CreatedBy;
      if (createdBy !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied',
          message: 'You can only edit BD entries you created'
        });
      }

      await pool.request()
        .input('BDID', id)
        .input('Description', Description)
        .input('Date', Date)
        .input('MeetingLink', MeetingLink || null)
        .query(`
          UPDATE tenderBD
          SET Description = @Description,
              Date = @Date,
              MeetingLink = @MeetingLink,
              LastUpdated = GETDATE()
          WHERE BDID = @BDID
        `);

      res.json({
        success: true,
        message: 'BD entry updated successfully'
      });
    } catch (error) {
      console.error('Error updating BD entry:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update BD entry',
        message: error.message
      });
    }
  },

  // DELETE /api/bd/:id - Delete a BD entry
  deleteBD: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await getConnectedPool();
      const userId = req.user.UserID;

      // Check if BD entry exists and user has permission
      const checkResult = await pool.request()
        .input('BDID', id)
        .input('UserID', userId)
        .query(`
          SELECT CreatedBy FROM tenderBD WHERE BDID = @BDID
        `);

      if (checkResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'BD entry not found'
        });
      }

      // Check if user is the creator (for now, only creator can delete)
      const createdBy = checkResult.recordset[0].CreatedBy;
      if (createdBy !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Permission denied',
          message: 'You can only delete BD entries you created'
        });
      }

      await pool.request()
        .input('BDID', id)
        .query(`
          DELETE FROM tenderBD WHERE BDID = @BDID
        `);

      res.json({
        success: true,
        message: 'BD entry deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting BD entry:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete BD entry',
        message: error.message
      });
    }
  }
};

module.exports = bdController;

