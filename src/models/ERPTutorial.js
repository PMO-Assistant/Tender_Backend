const { pool, poolConnect } = require('../config/database');

class ERPTutorial {
  constructor(data) {
    this.id = data.id
    this.title = data.title
    this.subtitle = data.subtitle
    this.location = data.location
    this.content = data.content
    this.created_at = data.created_at
    this.updated_at = data.updated_at
  }

  static async findAll() {
    try {
      await poolConnect;
      const result = await pool.request().query('SELECT * FROM PortalERPTutorials ORDER BY created_at DESC');
      return result.recordset;
    } catch (error) {
      throw new Error(`Error fetching ERP tutorials: ${error.message}`)
    }
  }

  static async findById(id) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('id', id)
        .query('SELECT * FROM PortalERPTutorials WHERE id = @id');
      return result.recordset[0];
    } catch (error) {
      throw new Error(`Error fetching ERP tutorial: ${error.message}`)
    }
  }

  static async create(tutorialData) {
    try {
      const { id, title, subtitle, location, content } = tutorialData
      await poolConnect;
      const result = await pool.request()
        .input('id', id)
        .input('title', title)
        .input('subtitle', subtitle)
        .input('location', location)
        .input('content', content)
        .query(`
          INSERT INTO PortalERPTutorials (id, title, subtitle, location, content)
          VALUES (@id, @title, @subtitle, @location, @content)
        `);
      return { id, title, subtitle, location, content }
    } catch (error) {
      throw new Error(`Error creating ERP tutorial: ${error.message}`)
    }
  }

  static async update(id, tutorialData) {
    try {
      const { title, subtitle, location, content } = tutorialData
      await poolConnect;
      const result = await pool.request()
        .input('id', id)
        .input('title', title)
        .input('subtitle', subtitle)
        .input('location', location)
        .input('content', content)
        .query(`
          UPDATE PortalERPTutorials 
          SET title = @title, subtitle = @subtitle, location = @location, content = @content
          WHERE id = @id
        `);
      if (result.rowsAffected[0] === 0) {
        throw new Error('ERP tutorial not found')
      }
      return { id, title, subtitle, location, content }
    } catch (error) {
      throw new Error(`Error updating ERP tutorial: ${error.message}`)
    }
  }

  static async delete(id) {
    try {
      await poolConnect;
      const result = await pool.request()
        .input('id', id)
        .query('DELETE FROM PortalERPTutorials WHERE id = @id');
      if (result.rowsAffected[0] === 0) {
        throw new Error('ERP tutorial not found')
      }
      return true
    } catch (error) {
      throw new Error(`Error deleting ERP tutorial: ${error.message}`)
    }
  }
}

module.exports = ERPTutorial 