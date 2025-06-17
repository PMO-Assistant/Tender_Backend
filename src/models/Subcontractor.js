const { pool, poolConnect } = require('../config/database');
const sql = require('mssql');

class Subcontractor {
  // --- PortalSubbies ---
  static async getAll() {
    try {
      await poolConnect;
      const result = await pool.request().query(`
        SELECT 
          s.*,
          COALESCE(
            (
              SELECT AVG(CAST(
                (r.Safety + r.Quality + r.Programme + r.Management + r.Commercial) / 5.0 
                AS DECIMAL(3,1))
              )
              FROM PortalSubbiesReview r
              WHERE r.SubID = s.SubID
            ),
            0
          ) as AverageRating,
          (
            SELECT COUNT(*)
            FROM PortalSubbiesReview r
            WHERE r.SubID = s.SubID
          ) as TotalProjects
        FROM PortalSubbies s
        ORDER BY s.SubName
      `);
      return result.recordset;
    } catch (err) {
      throw err;
    }
  }

  static async getById(SubID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('SubID', SubID)
        .query('SELECT * FROM PortalSubbies WHERE SubID = @SubID');
      return result.recordset[0];
    } catch (err) {
      throw err;
    }
  }

  static async create(sub) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('SubID', sub.SubID)
        .input('SubName', sub.SubName)
        .input('SubPhone', sub.SubPhone)
        .input('SubEmail', sub.SubEmail)
        .input('SubType', sub.SubType)
        .query(`INSERT INTO PortalSubbies (SubID, SubName, SubPhone, SubEmail, SubType) VALUES (@SubID, @SubName, @SubPhone, @SubEmail, @SubType)`);
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  static async update(SubID, sub) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('SubID', SubID)
        .input('SubName', sub.SubName)
        .input('SubPhone', sub.SubPhone)
        .input('SubEmail', sub.SubEmail)
        .input('SubType', sub.SubType)
        .query(`UPDATE PortalSubbies SET SubName=@SubName, SubPhone=@SubPhone, SubEmail=@SubEmail, SubType=@SubType WHERE SubID=@SubID`);
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  static async delete(SubID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('SubID', SubID)
        .query('DELETE FROM PortalSubbies WHERE SubID = @SubID');
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  // --- PortalSubbiesReview ---
  static async getAllReviews(SubID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('SubID', SubID)
        .query('SELECT * FROM PortalSubbiesReview WHERE SubID = @SubID ORDER BY Date DESC');
      return result.recordset;
    } catch (err) {
      throw err;
    }
  }

  static async getReviewById(ReviewID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('ReviewID', ReviewID)
        .query('SELECT * FROM PortalSubbiesReview WHERE ReviewID = @ReviewID');
      return result.recordset[0];
    } catch (err) {
      throw err;
    }
  }

  static async createReview(review) {
    try {
      await poolConnect;
      const request = pool.request();
      
      request.input('Date', review.Date);
      request.input('SubID', review.SubID);
      request.input('ProjectNo', sql.Int, parseInt(review.ProjectNo));
      request.input('ProjectName', review.ProjectName);
      request.input('Scope', review.Scope);
      request.input('Pros', review.Pros);
      request.input('Cons', review.Cons);
      request.input('Safety', review.Safety); // Default to 3 if not provided
      request.input('Quality', review.Quality); // Default to 3 if not provided
      request.input('Programme', review.Programme); // Default to 3 if not provided
      request.input('Management', review.Management); // Default to 3 if not provided
      request.input('Commercial', review.Commercial); // Default to 3 if not provided
      request.input('Environment', review.Environment); // Default to 3 if not provided

      const query = 'INSERT INTO PortalSubbiesReview (Date, SubID, ProjectNo, ProjectName, Scope, Pros, Cons, Safety, Quality, Programme, Management, Commercial, Environment) VALUES (@Date, @SubID, @ProjectNo, @ProjectName, @Scope, @Pros, @Cons, @Safety, @Quality, @Programme, @Management, @Commercial, @Environment)';
      
      const result = await request.query(query);
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  static async updateReview(ReviewID, review) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('ReviewID', ReviewID)
        .input('Date', review.Date)
        .input('ProjectNo', sql.Int, parseInt(review.ProjectNo))
        .input('ProjectName', review.ProjectName)
        .input('Scope', review.Scope)
        .input('Pros', review.Pros)
        .input('Cons', review.Cons)
        .input('Safety', review.Safety) // Default to 3 if not provided
        .input('Quality', review.Quality) // Default to 3 if not provided
        .input('Programme', review.Programme) // Default to 3 if not provided
        .input('Management', review.Management) // Default to 3 if not provided
        .input('Commercial', review.Commercial) // Default to 3 if not provided
        .input('Environment', review.Environment) // Default to 3 if not provided
        .query(`UPDATE PortalSubbiesReview 
                SET Date=@Date, 
                    ProjectNo=@ProjectNo, 
                    ProjectName=@ProjectName,
                    Scope=@Scope, 
                    Pros=@Pros, 
                    Cons=@Cons, 
                    Safety=@Safety, 
                    Quality=@Quality, 
                    Programme=@Programme, 
                    Management=@Management, 
                    Commercial=@Commercial,
                    Environment=@Environment
                WHERE ReviewID=@ReviewID`);
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  static async deleteReview(ReviewID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('ReviewID', ReviewID)
        .query('DELETE FROM PortalSubbiesReview WHERE ReviewID = @ReviewID');
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  // --- PortalSubbiesComment ---
  static async getAllComments(SubID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('SubID', sql.VarChar, SubID)
        .query(`
          SELECT c.*, r.ProjectName
          FROM PortalSubbiesComment c
          LEFT JOIN PortalSubbiesReview r ON c.ProjectNo = r.ProjectNo AND c.SubID = r.SubID
          WHERE c.SubID = @SubID 
          ORDER BY c.DateTime DESC
        `);
      return result.recordset;
    } catch (err) {
      throw err;
    }
  }

  static async getCommentById(CommentID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('CommentID', CommentID)
        .query(`
          SELECT c.*, r.ProjectNo, r.ProjectName
          FROM PortalSubbiesComment c
          JOIN PortalSubbiesReview r ON c.ProjectNo = r.ProjectNo AND c.SubID = r.SubID
          WHERE c.CommentID = @CommentID
        `);
      return result.recordset[0];
    } catch (err) {
      throw err;
    }
  }

  static async createComment(comment) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('SubID', sql.VarChar, comment.SubID)
        .input('ProjectNo', sql.Int, parseInt(comment.ProjectNo))
        .input('Commenter', sql.NVarChar, comment.Commenter)
        .input('Comment', sql.NVarChar, comment.Comment)
        .input('DateTime', sql.DateTime, comment.DateTime)
        .query(`
          INSERT INTO PortalSubbiesComment (SubID, ProjectNo, Commenter, Comment, DateTime) 
          VALUES (@SubID, @ProjectNo, @Commenter, @Comment, @DateTime)
        `);
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  static async updateComment(CommentID, comment) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('CommentID', CommentID)
        .input('ProjectNo', sql.Int, parseInt(comment.ProjectNo))
        .input('Comment', comment.Comment)
        .query(`
          UPDATE PortalSubbiesComment 
          SET ProjectNo=@ProjectNo, Comment=@Comment 
          WHERE CommentID=@CommentID
        `);
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  static async deleteComment(CommentID) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('CommentID', CommentID)
        .query('DELETE FROM PortalSubbiesComment WHERE CommentID = @CommentID');
      return result.rowsAffected[0] > 0;
    } catch (err) {
      throw err;
    }
  }

  static async bulkCreate(subcontractors, transaction) {
    for (const sub of subcontractors) {
      const request = new sql.Request(transaction);
      await request
        .input('SubID', sql.VarChar, sub.SubID)
        .input('SubName', sql.NVarChar, sub.SubName)
        .input('SubType', sql.NVarChar, sub.SubType)
        .input('SubPhone', sql.NVarChar, sub.SubPhone)
        .input('SubEmail', sql.NVarChar, sub.SubEmail)
        .query(`
          MERGE PortalSubbies AS target
          USING (SELECT @SubID AS SubID) AS source
          ON (target.SubID = source.SubID)
          WHEN MATCHED THEN 
            UPDATE SET 
              SubName = @SubName, 
              SubType = @SubType, 
              SubPhone = @SubPhone, 
              SubEmail = @SubEmail
          WHEN NOT MATCHED THEN
            INSERT (SubID, SubName, SubType, SubPhone, SubEmail)
            VALUES (@SubID, @SubName, @SubType, @SubPhone, @SubEmail);
        `);
    }
  
    return true;
  }

  

  static async bulkCreateReviews(reviews, transaction) {
    for (const review of reviews) {
      const request = new sql.Request(transaction);
  
      // Ensure Date is properly formatted or use current date
      const reviewDate = review.Date ? new Date(review.Date) : new Date();
      request.input('Date', sql.Date, reviewDate);
      request.input('SubID', sql.VarChar, review.SubID);
      request.input('ProjectNo', sql.Int, parseInt(review.ProjectNo));
      request.input('ProjectName', sql.NVarChar, review.ProjectName || '');
      request.input('Scope', sql.NVarChar, review.Scope || '');
      request.input('Pros', sql.NVarChar, review.Pros || '');
      request.input('Cons', sql.NVarChar, review.Cons || '');
      request.input('Safety', review.Safety ? sql.Int : sql.NVarChar, review.Safety || null);
      request.input('Quality', review.Quality ? sql.Int : sql.NVarChar, review.Quality || null);
      request.input('Programme', review.Programme ? sql.Int : sql.NVarChar, review.Programme || null);
      request.input('Management', review.Management ? sql.Int : sql.NVarChar, review.Management || null);
      request.input('Commercial', review.Commercial ? sql.Int : sql.NVarChar, review.Commercial || null);
      request.input('Environment', review.Environment ? sql.Int : sql.NVarChar, review.Environment || null);
  
      await request.query(`
        INSERT INTO PortalSubbiesReview (
          Date, SubID, ProjectNo, ProjectName, Scope,
          Pros, Cons, Safety, Quality, Programme,
          Management, Commercial, Environment
        ) VALUES (
          @Date, @SubID, @ProjectNo, @ProjectName, @Scope,
          @Pros, @Cons, @Safety, @Quality, @Programme,
          @Management, @Commercial, @Environment
        )
      `);
    }
  
    return true;
  }
  
}

module.exports = Subcontractor; 