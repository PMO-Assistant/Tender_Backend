const { getConnectedPool } = require('../../config/database');

const rfiController = {
  // POST /api/rfi/:tenderId/text - Create RFI with text-only HTML content
  createRFIText: async (req, res) => {
    try {
      const { tenderId } = req.params;
      const { content, type } = req.body;

      if (!content) {
        return res.status(400).json({ 
          error: 'Content is required' 
        });
      }

      const pool = await getConnectedPool();
      const userName = req.user.Name || req.user.Email || 'Unknown User'; // Get user name from auth middleware

      // Create RFI record with text-only content
      const rfiResult = await pool.request()
        .input('TenderID', tenderId)
        .input('Type', type || 'Text Input')
        .input('Content', content)
        .input('AddBy', userName) // Use user name from auth middleware
        .query(`
          INSERT INTO tenderRFI (TenderID, Type, Content, AddBy)
          OUTPUT INSERTED.RfiId
          VALUES (@TenderID, @Type, @Content, @AddBy)
        `);

      const rfiId = rfiResult.recordset[0].RfiId;

      return res.status(201).json({
        success: true,
        message: 'RFI created successfully',
        rfiId: rfiId
      });

    } catch (error) {
      console.error('Error creating text RFI:', error);
      res.status(500).json({ error: 'Failed to create text RFI' });
    }
  },

  // GET /api/rfi/:tenderId - Get all RFIs for a tender
  getRFIs: async (req, res) => {
    try {
      const { tenderId } = req.params;
      const pool = await getConnectedPool();

      const result = await pool.request()
        .input('TenderID', tenderId)
        .query(`
          SELECT 
            r.RfiId,
            r.TenderID,
            r.FileID,
            r.AddBy,
            r.UploadedOn,
            r.Type,
            r.Content
          FROM tenderRFI r
          WHERE r.TenderID = @TenderID
          ORDER BY r.UploadedOn DESC
        `);

      return res.json({
        success: true,
        rfis: result.recordset
      });

    } catch (error) {
      console.error('Error fetching RFIs:', error);
      res.status(500).json({ error: 'Failed to fetch RFIs' });
    }
  },

  // GET /api/rfi/:tenderId/:rfiId - Get specific RFI
  getRFI: async (req, res) => {
    try {
      const { tenderId, rfiId } = req.params;
      const pool = await getConnectedPool();

      const result = await pool.request()
        .input('RfiId', rfiId)
        .input('TenderID', tenderId)
        .query(`
          SELECT 
            r.RfiId,
            r.TenderID,
            r.FileID,
            r.AddBy,
            r.UploadedOn,
            r.Type,
            r.Content
          FROM tenderRFI r
          WHERE r.RfiId = @RfiId AND r.TenderID = @TenderID
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'RFI not found' });
      }

      return res.json({
        success: true,
        rfi: result.recordset[0]
      });

    } catch (error) {
      console.error('Error fetching RFI:', error);
      res.status(500).json({ error: 'Failed to fetch RFI' });
    }
  },

  // PUT /api/rfi/:tenderId/:rfiId - Update RFI
  updateRFI: async (req, res) => {
    try {
      const { tenderId, rfiId } = req.params;
      const { content, type } = req.body;

      if (!content) {
        return res.status(400).json({ 
          error: 'Content is required' 
        });
      }

      const pool = await getConnectedPool();

      const result = await pool.request()
        .input('RfiId', rfiId)
        .input('TenderID', tenderId)
        .input('Type', type || 'Text Input')
        .input('Content', content)
        .query(`
          UPDATE tenderRFI 
          SET Type = @Type, Content = @Content
          WHERE RfiId = @RfiId AND TenderID = @TenderID
        `);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ error: 'RFI not found' });
      }

      return res.json({
        success: true,
        message: 'RFI updated successfully'
      });

    } catch (error) {
      console.error('Error updating RFI:', error);
      res.status(500).json({ error: 'Failed to update RFI' });
    }
  },

  // DELETE /api/rfi/:tenderId/:rfiId - Delete RFI
  deleteRFI: async (req, res) => {
    try {
      const { tenderId, rfiId } = req.params;
      const pool = await getConnectedPool();

      const result = await pool.request()
        .input('RfiId', rfiId)
        .input('TenderID', tenderId)
        .query(`
          DELETE FROM tenderRFI 
          WHERE RfiId = @RfiId AND TenderID = @TenderID
        `);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ error: 'RFI not found' });
      }

      return res.json({
        success: true,
        message: 'RFI deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting RFI:', error);
      res.status(500).json({ error: 'Failed to delete RFI' });
    }
  }
};

module.exports = rfiController;