router.post('/validate-reviews', async (req, res) => {
  try {
    const { reviews } = req.body;
    const validationResults = {
      valid: true,
      errors: []
    };

    // Get all existing SubIDs
    const existingSubs = await pool.request()
      .query('SELECT SubID FROM PortalSubbies');
    const validSubIDs = new Set(existingSubs.recordset.map(sub => sub.SubID));

    reviews.forEach((review, index) => {
      const rowErrors = [];

      // Check if SubID exists
      if (!validSubIDs.has(review.SubID)) {
        rowErrors.push({
          field: 'SubID',
          message: 'Subcontractor ID does not exist'
        });
      }

      // Validate rating fields (1-5)
      const ratingFields = ['Safety', 'Quality', 'Programme', 'Management', 'Commercial', 'Environment'];
      ratingFields.forEach(field => {
        const value = review[field];
        // Convert to number and check if it's a valid integer between 1-5
        const numValue = Number(value);
        if (value === '' || value === null || value === undefined || 
            isNaN(numValue) || !Number.isInteger(numValue) || numValue < 1 || numValue > 5) {
          rowErrors.push({
            field,
            message: `${field} rating must be a whole number between 1 and 5`
          });
        }
      });

      // Validate required fields
      const requiredFields = ['Date', 'SubID', 'ProjectNo', 'ProjectName', 'Scope'];
      requiredFields.forEach(field => {
        if (!review[field]) {
          rowErrors.push({
            field,
            message: `${field} is required`
          });
        }
      });

      if (rowErrors.length > 0) {
        validationResults.valid = false;
        validationResults.errors.push({
          row: index + 2, // +2 because of 0-based index and header row
          errors: rowErrors
        });
      }
    });

    res.json(validationResults);
  } catch (error) {
    console.error('Error validating reviews:', error);
    res.status(500).json({ error: 'Error validating reviews' });
  }
}); 