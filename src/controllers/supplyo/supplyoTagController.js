const { getConnectedPool } = require('../../config/database');

// Controller for managing Supplyo tags and company-tag links
const supplyoTagController = {
  // Get all tags
  getAllTags: async (req, res) => {
    try {
      const pool = await getConnectedPool();
      const result = await pool.request()
        .query(`
          SELECT 
            TagID,
            Name,
            Color,
            CreatedAt,
            CreatedBy
          FROM tenderSupplyoTag
          ORDER BY Name
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error('Error fetching Supplyo tags:', err);
      res.status(500).json({ message: err.message });
    }
  },

  // Create a new tag
  createTag: async (req, res) => {
    try {
      const { Name, Color } = req.body;
      const userId = req.user?.UserID || null;

      if (!Name || !Name.trim()) {
        return res.status(400).json({ message: 'Tag name is required' });
      }

      const pool = await getConnectedPool();

      // Ensure uniqueness by name
      const existing = await pool.request()
        .input('Name', Name.trim())
        .query(`
          SELECT TagID FROM tenderSupplyoTag WHERE Name = @Name
        `);

      if (existing.recordset.length > 0) {
        return res.status(409).json({ message: 'A tag with this name already exists' });
      }

      const result = await pool.request()
        .input('Name', Name.trim())
        .input('Color', Color || null)
        .input('CreatedBy', userId)
        .query(`
          INSERT INTO tenderSupplyoTag (Name, Color, CreatedAt, CreatedBy)
          OUTPUT INSERTED.TagID, INSERTED.Name, INSERTED.Color, INSERTED.CreatedAt, INSERTED.CreatedBy
          VALUES (@Name, @Color, GETDATE(), @CreatedBy)
        `);

      res.status(201).json({
        message: 'Tag created successfully',
        tag: result.recordset[0]
      });
    } catch (err) {
      console.error('Error creating Supplyo tag:', err);
      res.status(500).json({ message: err.message });
    }
  },

  // Delete a tag (and its company links)
  deleteTag: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await getConnectedPool();

      // Remove links first
      await pool.request()
        .input('TagID', id)
        .query(`
          DELETE FROM tenderSupplyoCompanyTag WHERE TagID = @TagID
        `);

      const result = await pool.request()
        .input('TagID', id)
        .query(`
          DELETE FROM tenderSupplyoTag WHERE TagID = @TagID
        `);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ message: 'Tag not found' });
      }

      res.json({ message: 'Tag deleted successfully' });
    } catch (err) {
      console.error('Error deleting Supplyo tag:', err);
      res.status(500).json({ message: err.message });
    }
  },

  // Get tags for a specific company
  getCompanyTags: async (req, res) => {
    try {
      const { id } = req.params; // CompanyID
      const pool = await getConnectedPool();

      const result = await pool.request()
        .input('CompanyID', id)
        .query(`
          SELECT t.TagID, t.Name, t.Color
          FROM tenderSupplyoCompanyTag ct
          INNER JOIN tenderSupplyoTag t ON ct.TagID = t.TagID
          WHERE ct.CompanyID = @CompanyID
          ORDER BY t.Name
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error('Error fetching tags for Supplyo company:', err);
      res.status(500).json({ message: err.message });
    }
  },

  // Set tags for a company (replace existing)
  setCompanyTags: async (req, res) => {
    try {
      const { id } = req.params; // CompanyID
      const { tagIds } = req.body;

      if (!Array.isArray(tagIds)) {
        return res.status(400).json({ message: 'tagIds array is required' });
      }

      const pool = await getConnectedPool();

      // Remove existing links
      await pool.request()
        .input('CompanyID', id)
        .query(`
          DELETE FROM tenderSupplyoCompanyTag WHERE CompanyID = @CompanyID
        `);

      // Insert new links
      if (tagIds.length > 0) {
        const insertRequest = pool.request()
          .input('CompanyID', id);

        const values = tagIds.map((tagId, index) => {
          insertRequest.input(`TagID${index}`, tagId);
          return `(@CompanyID, @TagID${index}, GETDATE())`;
        }).join(', ');

        await insertRequest.query(`
          INSERT INTO tenderSupplyoCompanyTag (CompanyID, TagID, CreatedAt)
          VALUES ${values}
        `);
      }

      res.json({ message: 'Company tags updated successfully' });
    } catch (err) {
      console.error('Error setting tags for Supplyo company:', err);
      res.status(500).json({ message: err.message });
    }
  }
};

module.exports = supplyoTagController;

