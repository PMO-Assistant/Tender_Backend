const Subcontractor = require('../models/Subcontractor');
const csv = require('csv-parse');
const fs = require('fs');
const path = require('path');
const { pool, poolConnect } = require('../config/database');
const sql = require('mssql');

// Configure file size limit (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const subcontractorController = {
  // --- Subcontractors ---
  getAll: async (req, res) => {
    try {
      await poolConnect;
      // First get all subcontractors
      const subs = await Subcontractor.getAll();

      // For each subcontractor, calculate their ratings
      const subsWithRatings = await Promise.all(subs.map(async (sub) => {
        // Get all reviews for this subcontractor
        const reviews = await pool.request()
          .input('SubID', sql.VarChar, sub.SubID)
          .query(`
            SELECT 
              ProjectNo,
              Safety,
              Quality,
              Programme,
              Management,
              Commercial
            FROM PortalSubbiesReview 
            WHERE SubID = @SubID
          `);

        // Calculate individual project ratings
        const projectRatings = reviews.recordset.map(review => {
          // Only include ratings that are not null, undefined, or 0
          const validRatings = [
            review.Safety,
            review.Quality,
            review.Programme,
            review.Management,
            review.Commercial
          ].filter(rating => rating !== null && rating !== undefined && rating !== 0);

          // If no valid ratings, return null
          if (validRatings.length === 0) return null;
          
          // Calculate individual project rating (sum of valid fields / number of valid fields)
          const projectRating = validRatings.reduce((a, b) => a + b, 0) / validRatings.length;
          return {
            projectNo: review.ProjectNo,
            rating: parseFloat(projectRating.toFixed(1))
          };
        }).filter(rating => rating !== null);

        // Calculate overall rating (average of all project ratings)
        const overallRating = projectRatings.length > 0
          ? projectRatings.reduce((sum, project) => sum + project.rating, 0) / projectRatings.length
          : null;

        // Get total number of projects
        const totalProjects = reviews.recordset.length;

        return {
          ...sub,
          AverageRating: overallRating !== null ? parseFloat(overallRating.toFixed(1)) : null,
          TotalProjects: totalProjects,
          ProjectRatings: projectRatings
        };
      }));

      res.json(subsWithRatings);
    } catch (err) {
      console.error('Error in getAll:', err);
      res.status(500).json({ message: err.message });
    }
  },
  getById: async (req, res) => {
    try {
      const sub = await Subcontractor.getById(req.params.id);
      if (!sub) return res.status(404).json({ message: 'Subcontractor not found' });
      res.json(sub);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  create: async (req, res) => {
    try {
      const created = await Subcontractor.create(req.body);
      if (created) return res.status(201).json({ message: 'Subcontractor created' });
      res.status(400).json({ message: 'Failed to create subcontractor' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  update: async (req, res) => {
    try {
      const updated = await Subcontractor.update(req.params.id, req.body);
      if (updated) return res.json({ message: 'Subcontractor updated' });
      res.status(404).json({ message: 'Subcontractor not found' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  delete: async (req, res) => {
    try {
      const deleted = await Subcontractor.delete(req.params.id);
      if (deleted) return res.json({ message: 'Subcontractor deleted' });
      res.status(404).json({ message: 'Subcontractor not found' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },

  // Bulk create subcontractors
  bulkCreate: async (req, res) => {
    try {
      const { pool, poolConnect } = require('../config/database');
      await poolConnect;
      
      const subcontractors = req.body;
      
      if (!Array.isArray(subcontractors) || subcontractors.length === 0) {
        return res.status(400).json({ message: 'Invalid data: expected non-empty array of subcontractors' });
      }

      // Start transaction
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        // Validate all subcontractors first
        for (const sub of subcontractors) {
          if (!sub.SubID || !sub.SubName) {
            await transaction.rollback();
            return res.status(400).json({ message: 'All subcontractors must have SubID and SubName' });
          }
        }

        // Check for existing SubIDs
        const subIDs = subcontractors.map(sub => sub.SubID);
        
        // Build dynamic query with proper parameter binding
        const placeholders = subIDs.map((_, index) => `@subID${index}`).join(',');
        const query = `SELECT SubID FROM PortalSubbies WHERE SubID IN (${placeholders})`;
        
        const request = pool.request();
        subIDs.forEach((subID, index) => {
          request.input(`subID${index}`, sql.VarChar, subID);
        });
        
        const existingCheck = await request.query(query);

        if (existingCheck.recordset.length > 0) {
          await transaction.rollback();
          const existingSubIDs = existingCheck.recordset.map(r => r.SubID);
          return res.status(400).json({ 
            message: `The following SubIDs already exist: ${existingSubIDs.join(', ')}` 
          });
        }

        // Create all subcontractors
        const created = await Subcontractor.bulkCreate(subcontractors, transaction);
        
        if (created) {
          await transaction.commit();
          res.status(201).json({ 
            message: `${subcontractors.length} subcontractor(s) created successfully`,
            count: subcontractors.length
          });
        } else {
          await transaction.rollback();
          res.status(400).json({ message: 'Failed to create subcontractors' });
        }
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Error in bulkCreate:', err);
      res.status(500).json({ message: err.message });
    }
  },

  // Bulk create reviews
  bulkCreateReviews: async (req, res) => {
    try {
      const { pool, poolConnect } = require('../config/database');
      await poolConnect;
      
      const reviews = req.body;
      
      if (!Array.isArray(reviews) || reviews.length === 0) {
        return res.status(400).json({ message: 'Invalid data: expected non-empty array of reviews' });
      }

      // Start transaction
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        // Validate all reviews first
        for (const review of reviews) {
          if (!review.SubID || !review.ProjectNo) {
            await transaction.rollback();
            return res.status(400).json({ message: 'All reviews must have SubID and ProjectNo' });
          }
        }

        // Create all reviews
        const created = await Subcontractor.bulkCreateReviews(reviews, transaction);
        
        if (created) {
          await transaction.commit();
          res.status(201).json({ 
            message: `${reviews.length} review(s) created successfully`,
            count: reviews.length
          });
        } else {
          await transaction.rollback();
          res.status(400).json({ message: 'Failed to create reviews' });
        }
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Error in bulkCreateReviews:', err);
      res.status(500).json({ message: err.message });
    }
  },

  // --- Reviews ---
  getAllReviews: async (req, res) => {
    try {
      const reviews = await Subcontractor.getAllReviews(req.params.subid);
      res.json(reviews);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  getReviewById: async (req, res) => {
    try {
      const review = await Subcontractor.getReviewById(req.params.reviewid);
      if (!review) return res.status(404).json({ message: 'Review not found' });
      res.json(review);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  createReview: async (req, res) => {
    try {
      const created = await Subcontractor.createReview(req.body);
      if (created) return res.status(201).json({ message: 'Review created' });
      res.status(400).json({ message: 'Failed to create review' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  updateReview: async (req, res) => {
    try {
      const updated = await Subcontractor.updateReview(req.params.reviewid, req.body);
      if (updated) return res.json({ message: 'Review updated' });
      res.status(404).json({ message: 'Review not found' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  deleteReview: async (req, res) => {
    try {
      const deleted = await Subcontractor.deleteReview(req.params.reviewid);
      if (deleted) return res.json({ message: 'Review deleted' });
      res.status(404).json({ message: 'Review not found' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },

  // --- Comments ---
  getAllComments: async (req, res) => {
    try {
      const { subid } = req.params;
      await poolConnect;
      
      // Use DISTINCT to ensure unique comments based on CommentID, SubID, and ProjectNo
      const result = await pool.request()
        .input('SubID', sql.VarChar, subid)
        .query(`
          SELECT DISTINCT 
            c.CommentID,
            c.SubID,
            c.ProjectNo,
            c.Commenter,
            c.Comment,
            c.DateTime
          FROM PortalSubbiesComment c
          WHERE c.SubID = @SubID
          ORDER BY c.DateTime DESC
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error('Error fetching comments:', err);
      res.status(500).json({ message: err.message });
    }
  },
  getCommentById: async (req, res) => {
    try {
      const comment = await Subcontractor.getCommentById(req.params.commentid);
      if (!comment) return res.status(404).json({ message: 'Comment not found' });
      res.json(comment);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  createComment: async (req, res) => {
    try {
      const { SubID, ProjectNo, Commenter, Comment, DateTime } = req.body;
      await poolConnect;

      if (!SubID || !ProjectNo || !Commenter || !Comment) {
        return res.status(400).json({ 
          message: 'Missing required fields',
          details: {
            SubID: SubID ? 'OK' : 'Missing',
            ProjectNo: ProjectNo ? 'OK' : 'Missing',
            Commenter: Commenter ? 'OK' : 'Missing',
            Comment: Comment ? 'OK' : 'Missing'
          }
        });
      }

      // Verify that the project exists for this subcontractor
      const review = await pool.request()
        .input('SubID', sql.VarChar, SubID)
        .input('ProjectNo', sql.Int, parseInt(ProjectNo))
        .query('SELECT * FROM PortalSubbiesReview WHERE SubID = @SubID AND ProjectNo = @ProjectNo');

      if (review.recordset.length === 0) {
        return res.status(404).json({ 
          message: 'Project not found for this subcontractor',
          details: {
            SubID,
            ProjectNo
          }
        });
      }

      const created = await Subcontractor.createComment({
        SubID,
        ProjectNo: parseInt(ProjectNo),
        Commenter,
        Comment,
        DateTime: DateTime || new Date().toISOString().slice(0, 19).replace('T', ' ')
      });

      if (created) {
        // Return the created comment with its ID
        const result = await pool.request()
          .input('SubID', sql.VarChar, SubID)
          .input('ProjectNo', sql.Int, parseInt(ProjectNo))
          .input('Commenter', sql.NVarChar, Commenter)
          .input('Comment', sql.NVarChar, Comment)
          .query(`
            SELECT TOP 1 * FROM PortalSubbiesComment 
            WHERE SubID = @SubID 
            AND ProjectNo = @ProjectNo 
            AND Commenter = @Commenter 
            AND Comment = @Comment 
            ORDER BY DateTime DESC
          `);
        
        return res.status(201).json(result.recordset[0]);
      }
      
      res.status(400).json({ message: 'Failed to create comment' });
    } catch (err) {
      console.error('Error creating comment:', err);
      res.status(500).json({ message: err.message });
    }
  },
  updateComment: async (req, res) => {
    try {
      const { ProjectNo, Comment } = req.body;
      
      if (!ProjectNo || !Comment) {
        return res.status(400).json({ 
          message: 'Missing required fields',
          details: {
            ProjectNo: ProjectNo ? 'OK' : 'Missing',
            Comment: Comment ? 'OK' : 'Missing'
          }
        });
      }

      // Verify that the project exists
      const review = await Subcontractor.getReviewById(ProjectNo);
      if (!review) {
        return res.status(404).json({ message: 'Project not found' });
      }

      const updated = await Subcontractor.updateComment(req.params.commentid, {
        ProjectNo: parseInt(ProjectNo),
        Comment
      });

      if (updated) return res.json({ message: 'Comment updated' });
      res.status(404).json({ message: 'Comment not found' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },
  deleteComment: async (req, res) => {
    try {
      const deleted = await Subcontractor.deleteComment(req.params.commentid);
      if (deleted) return res.json({ message: 'Comment deleted' });
      res.status(404).json({ message: 'Comment not found' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  },

  // Helper to convert dd-mm-yyyy to yyyy-mm-dd
  convertDateToSQL: function convertDateToSQL(dateStr) {
    if (!dateStr) return null;
    // Accepts dd-mm-yyyy or dd/mm/yyyy
    const match = dateStr.match(/^(\d{2})[-\/]?(\d{2})[-\/]?(\d{4})$/);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    // fallback: try to parse as Date
    const d = new Date(dateStr);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return dateStr;
  },

  // Helper function to normalize column names
  normalizeColumnName: function normalizeColumnName(name) {
    const columnMap = {
      'ID': 'SubID',
      'SubbieID': 'SubID',
      'Name': 'SubName',
      'ServiceType': 'SubType',
      'Phone': 'SubPhone',
      'Email': 'SubEmail',
      'ServiceDate': 'Date',
      'ProjectName': 'ProjectName',
      'ProjectNo': 'ProjectNo',
      'Scope': 'Scope',
      'Pros': 'Pros',
      'Cons': 'Cons',
      'Safety': 'Safety',
      'Quality': 'Quality',
      'Programme': 'Programme',
      'Management': 'Management',
      'Commercial': 'Commercial',
      'Environment': 'Environment'
    };
    return columnMap[name] || name;
  },

  // Helper to find matching column in record
  findMatchingColumn: function findMatchingColumn(record, possibleNames) {
    const normalizedRecord = Object.keys(record).reduce((acc, key) => {
      acc[this.normalizeColumnName(key)] = record[key];
      return acc;
    }, {});

    for (const name of possibleNames) {
      const normalizedName = this.normalizeColumnName(name);
      if (normalizedName in normalizedRecord) {
        return record[Object.keys(record).find(k => this.normalizeColumnName(k) === normalizedName)];
      }
    }
    return null;
  },

  uploadCSV: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      // Check file size
      if (req.file.size > MAX_FILE_SIZE) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          message: 'File too large',
          details: {
            maxSize: '5MB',
            currentSize: `${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
          }
        });
      }

      const results = [];
      const parser = fs.createReadStream(req.file.path)
  .pipe(csv.parse({ skip_empty_lines: true }));

let isFirstRow = true;

for await (const row of parser) {
  // Skip header
  if (isFirstRow) {
    isFirstRow = false;
    continue;
  }

  const [id, name, type, phone, email] = row;

  if (!id || !name) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      message: 'Missing required fields',
      details: {
        id: id ? 'OK' : 'Missing',
        name: name ? 'OK' : 'Missing'
      }
    });
  }

  results.push({
    SubID: id.toString().trim(),
    SubName: name.toString().trim(),
    SubType: type ? type.toString().trim() : null,
    SubPhone: phone ? phone.toString().trim() : null,
    SubEmail: email ? email.toString().trim() : null
  });
}


      // Check for duplicate SubIDs
      const subIDs = results.map(r => r.SubID);
      const duplicates = subIDs.filter((id, index) => subIDs.indexOf(id) !== index);
      if (duplicates.length > 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          message: 'Duplicate SubIDs found in CSV',
          duplicates: [...new Set(duplicates)]
        });
      }

      // Use transaction for bulk insert
      const transaction = new sql.Transaction(pool);

try {
  await transaction.begin();

  const created = await Subcontractor.bulkCreate(results, transaction);
  await transaction.commit();
  fs.unlinkSync(req.file.path);

  if (created) {
    return res.status(201).json({ 
      message: 'Subcontractors imported successfully',
      count: results.length
    });
  }

  res.status(400).json({ message: 'Failed to import subcontractors' });
} catch (error) {
  await transaction.rollback();
  console.error('Transaction failed:', error);
  res.status(500).json({ 
    message: 'Error processing CSV file',
    error: error.message 
  });
}

    } catch (error) {
      console.error('CSV Upload Error:', error);
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(500).json({ 
        message: 'Error processing CSV file',
        error: error.message 
      });
    }
  },

  uploadRatingsCSV: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      // Check file size
      if (req.file.size > MAX_FILE_SIZE) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          message: 'File too large',
          details: {
            maxSize: '5MB',
            currentSize: `${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
          }
        });
      }

      const results = [];
      const parser = fs.createReadStream(req.file.path)
        .pipe(csv.parse({ skip_empty_lines: true }));

      let isFirstRow = true;

      // Helper function to convert date format
      const convertDateToSQL = (dateStr) => {
        if (!dateStr) return null;
        // Handle dd-mm-yyyy format
        const match = dateStr.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
        if (match) {
          return `${match[3]}-${match[2]}-${match[1]}`;
        }
        // Try to parse as Date if format is different
        const d = new Date(dateStr);
        if (!isNaN(d)) return d.toISOString().slice(0, 10);
        return dateStr;
      };

      for await (const row of parser) {
        // Skip header
        if (isFirstRow) {
          isFirstRow = false;
          continue;
        }

        // Expected columns in order:
        // Date, SubID, ProjectNo, ProjectName, Scope, Pros, Cons, Safety, Quality, Programme, Management, Commercial, Environment
        const [date, subID, projectNo, projectName, scope, pros, cons, safety, quality, programme, management, commercial, environment] = row;

        if (!date || !subID || !projectNo) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ 
            message: 'Missing required fields',
            details: {
              date: date ? 'OK' : 'Missing',
              subID: subID ? 'OK' : 'Missing',
              projectNo: projectNo ? 'OK' : 'Missing'
            }
          });
        }

        // Validate project number is a valid integer
        if (isNaN(parseInt(projectNo))) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ 
            message: 'Invalid project number',
            details: {
              projectNo,
              expected: 'Must be a valid integer'
            }
          });
        }

        // Validate ratings are between 1-5 only if they are provided
        const ratings = { safety, quality, programme, management, commercial, environment };
        const invalidRatings = Object.entries(ratings)
          .filter(([_, value]) => value && value !== '' && (isNaN(value) || value < 1 || value > 5))
          .map(([key]) => key);

        if (invalidRatings.length > 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ 
            message: 'Invalid ratings found',
            details: {
              invalidFields: invalidRatings,
              validRange: '1-5 or empty'
            }
          });
        }

        // Log the values for debugging
        console.log('Processing row:', {
          date,
          subID,
          projectNo,
          environment,
          parsedEnvironment: environment && environment !== '' ? parseInt(environment) : null
        });

        results.push({
          Date: convertDateToSQL(date),
          SubID: subID.toString().trim(),
          ProjectNo: parseInt(projectNo),
          ProjectName: projectName ? projectName.toString().trim() : null,
          Scope: scope ? scope.toString().trim() : null,
          Pros: pros ? pros.toString().trim() : null,
          Cons: cons ? cons.toString().trim() : null,
          Safety: safety && safety !== '' ? parseInt(safety) : null,
          Quality: quality && quality !== '' ? parseInt(quality) : null,
          Programme: programme && programme !== '' ? parseInt(programme) : null,
          Management: management && management !== '' ? parseInt(management) : null,
          Commercial: commercial && commercial !== '' ? parseInt(commercial) : null,
          Environment: environment && environment !== '' ? parseInt(environment) : null
        });
      }

      // Check all SubIDs exist using a direct SQL query
      const allSubIDs = results.map(r => r.SubID);
      const uniqueSubIDs = [...new Set(allSubIDs)];

      if (uniqueSubIDs.length > 0) {
        // Create a simple query to check SubIDs
        const request = pool.request();
        const subIDList = uniqueSubIDs.map(id => `'${id}'`).join(',');
        
        const result = await request.query(`
          SELECT SubID, SubName 
          FROM PortalSubbies 
          WHERE SubID IN (${subIDList})
        `);
        
        const foundSubIDs = new Set(result.recordset.map(r => r.SubID));
        const subIDNameMap = Object.fromEntries(result.recordset.map(r => [r.SubID, r.SubName]));
        
        const invalidSubIDs = uniqueSubIDs.filter(id => !foundSubIDs.has(id));
        if (invalidSubIDs.length > 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ 
            message: 'Some SubIDs do not exist',
            invalidSubIDs,
            subIDNameMap
          });
        }

        // Use transaction for bulk insert
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
          const created = await Subcontractor.bulkCreateReviews(results, transaction);
          await transaction.commit();
          fs.unlinkSync(req.file.path);
          
          if (created) {
            return res.status(201).json({ 
              message: 'Reviews imported successfully',
              count: results.length,
              subIDNameMap
            });
          }
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      }
      
      res.status(400).json({ message: 'Failed to import reviews' });
    } catch (error) {
      console.error('CSV Reviews Upload Error:', error);
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(500).json({ 
        message: 'Error processing reviews CSV file',
        error: error.message 
      });
    }
  },

  uploadReviewsCSV: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      // Check file size
      if (req.file.size > MAX_FILE_SIZE) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ 
          message: 'File too large',
          details: {
            maxSize: '5MB',
            currentSize: `${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
          }
        });
      }

      const results = [];
      const parser = fs.createReadStream(req.file.path)
        .pipe(csv.parse({ columns: true, skip_empty_lines: true }));

      for await (const record of parser) {
        // Try different possible column names for each field
        const date = this.findMatchingColumn(record, ['ServiceDate', 'Date', 'Review Date']);
        const subID = this.findMatchingColumn(record, ['SubID', 'SubbieID', 'ID', 'Subbie ID']);
        const projectNo = this.findMatchingColumn(record, ['ProjectNo', 'Project Number', 'Project #']);
        const projectName = this.findMatchingColumn(record, ['ProjectName', 'Project Name']);
        const scope = this.findMatchingColumn(record, ['Scope', 'Work Scope']);
        const pros = this.findMatchingColumn(record, ['Pros', 'Positive', 'Strengths']);
        const cons = this.findMatchingColumn(record, ['Cons', 'Negative', 'Weaknesses']);
        const safety = this.findMatchingColumn(record, ['Safety', 'Safety Rating']);
        const quality = this.findMatchingColumn(record, ['Quality', 'Quality Rating']);
        const programme = this.findMatchingColumn(record, ['Programme', 'Program', 'Schedule Rating']);
        const management = this.findMatchingColumn(record, ['Management', 'Management Rating']);
        const commercial = this.findMatchingColumn(record, ['Commercial', 'Commercial Rating']);
        const environment = this.findMatchingColumn(record, ['Environment', 'Environment', 'Environment Rating']);

        if (!date || !subID) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ 
            message: 'Missing required fields',
            details: {
              date: date ? 'OK' : 'Missing',
              subID: subID ? 'OK' : 'Missing'
            }
          });
        }

        // Validate ratings are between 1-5 only if they are provided
        const ratings = { safety, quality, programme, management, commercial, environment };
        const invalidRatings = Object.entries(ratings)
          .filter(([_, value]) => value && value !== '' && (isNaN(value) || value < 1 || value > 5))
          .map(([key]) => key);

        if (invalidRatings.length > 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ 
            message: 'Invalid ratings found',
            details: {
              invalidFields: invalidRatings,
              validRange: '1-5 or empty'
            }
          });
        }

        results.push({
          Date: this.convertDateToSQL(date),
          SubID: subID.toString().trim(),
          ProjectNo: projectNo ? projectNo.toString().trim() : null,
          ProjectName: projectName ? projectName.toString().trim() : null,
          Scope: scope ? scope.toString().trim() : null,
          Pros: pros ? pros.toString().trim() : null,
          Cons: cons ? cons.toString().trim() : null,
          Safety: safety && safety !== '' ? parseInt(safety) : null,
          Quality: quality && quality !== '' ? parseInt(quality) : null,
          Programme: programme && programme !== '' ? parseInt(programme) : null,
          Management: management && management !== '' ? parseInt(management) : null,
          Commercial: commercial && commercial !== '' ? parseInt(commercial) : null,
          Environment: environment && environment !== '' ? parseInt(environment) : null
        });
      }

      // Check all SubIDs exist using a direct SQL query
      const allSubIDs = results.map(r => r.SubID);
      const uniqueSubIDs = [...new Set(allSubIDs)];
      
      if (uniqueSubIDs.length > 0) {
        const placeholders = uniqueSubIDs.map(() => '?').join(',');
        const sql = `SELECT SubID, SubName FROM PortalSubbies WHERE SubID IN (${placeholders})`;
        const [rows] = await pool.query(sql, uniqueSubIDs);
        
        const foundSubIDs = new Set(rows.map(r => r.SubID));
        const subIDNameMap = Object.fromEntries(rows.map(r => [r.SubID, r.SubName]));
        
        const invalidSubIDs = uniqueSubIDs.filter(id => !foundSubIDs.has(id));
        if (invalidSubIDs.length > 0) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ 
            message: 'Some SubIDs do not exist',
            invalidSubIDs,
            subIDNameMap
          });
        }

        // Use transaction for bulk insert
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
          const created = await Subcontractor.bulkCreateReviews(results, connection);
          await connection.commit();
          fs.unlinkSync(req.file.path);
          
          if (created) {
            return res.status(201).json({ 
              message: 'Reviews imported successfully',
              count: results.length,
              subIDNameMap
            });
          }
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }
      
      res.status(400).json({ message: 'Failed to import reviews' });
    } catch (error) {
      console.error('CSV Reviews Upload Error:', error);
      if (req.file) fs.unlinkSync(req.file.path);
      res.status(500).json({ 
        message: 'Error processing reviews CSV file',
        error: error.message 
      });
    }
  },

  validateSubcontractorRow: function validateSubcontractorRow(row) {
    // Implementation of validateSubcontractorRow function
  },

  handleCSVFile: function handleCSVFile(file, type) {
    // Implementation of handleCSVFile function
  },

  // New endpoint to check if a SubID exists
  checkSubID: async (req, res) => {
    try {
      const { subID } = req.params;
      await poolConnect;
      const result = await pool.request()
        .input('SubID', sql.VarChar, subID)
        .query('SELECT COUNT(*) as count FROM PortalSubbies WHERE SubID = @SubID');
      
      const exists = result.recordset[0].count > 0;
      res.json({ exists });
    } catch (err) {
      console.error('Error checking SubID:', err);
      res.status(500).json({ message: err.message });
    }
  },

  // Check multiple SubIDs
  checkMultipleSubIDs: async (req, res) => {
    try {
      const { subIDs } = req.body;
      const { pool, poolConnect } = require('../config/database');
      await poolConnect;
      
      if (!Array.isArray(subIDs)) {
        return res.status(400).json({ message: 'subIDs must be an array' });
      }
      
      // Build dynamic query with proper parameter binding
      const placeholders = subIDs.map((_, index) => `@subID${index}`).join(',');
      const query = `SELECT SubID FROM PortalSubbies WHERE SubID IN (${placeholders})`;
      
      const request = pool.request();
      subIDs.forEach((subID, index) => {
        request.input(`subID${index}`, sql.VarChar, subID);
      });
      
      const result = await request.query(query);
      
      const existingSubIDs = result.recordset.map(r => r.SubID);
      res.json({ existingSubIDs });
    } catch (err) {
      console.error('Error checking multiple SubIDs:', err);
      res.status(500).json({ message: err.message });
    }
  },
};

module.exports = subcontractorController; 
