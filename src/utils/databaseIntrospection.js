const sql = require('mssql');

/**
 * Database Schema Introspection Module
 * 
 * This module provides comprehensive database schema analysis for Azure SQL Database.
 * It queries all user tables, their columns, and sample data to create a structured
 * representation suitable for AI prompt generation.
 */

/**
 * Get all user tables from the database
 * @param {sql.ConnectionPool} pool - Database connection pool
 * @returns {Promise<Array>} Array of table names
 */
async function getUserTables(pool) {
    try {
        const result = await pool.request().query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_TYPE = 'BASE TABLE' 
            AND TABLE_SCHEMA = 'dbo'
            ORDER BY TABLE_NAME
        `);
        
        return result.recordset.map(row => row.TABLE_NAME);
    } catch (error) {
        console.error('Error getting user tables:', error);
        throw new Error(`Failed to retrieve user tables: ${error.message}`);
    }
}

/**
 * Get column information for a specific table
 * @param {sql.ConnectionPool} pool - Database connection pool
 * @param {string} tableName - Name of the table
 * @returns {Promise<Array>} Array of column objects with name and type
 */
async function getTableColumns(pool, tableName) {
    try {
        const result = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(`
                SELECT 
                    COLUMN_NAME,
                    DATA_TYPE,
                    IS_NULLABLE,
                    CHARACTER_MAXIMUM_LENGTH,
                    NUMERIC_PRECISION,
                    NUMERIC_SCALE
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = @tableName
                ORDER BY ORDINAL_POSITION
            `);
        
        return result.recordset.map(row => ({
            name: row.COLUMN_NAME,
            type: row.DATA_TYPE,
            nullable: row.IS_NULLABLE === 'YES',
            maxLength: row.CHARACTER_MAXIMUM_LENGTH,
            precision: row.NUMERIC_PRECISION,
            scale: row.NUMERIC_SCALE
        }));
    } catch (error) {
        console.error(`Error getting columns for table ${tableName}:`, error);
        throw new Error(`Failed to retrieve columns for table ${tableName}: ${error.message}`);
    }
}

/**
 * Get sample data from a table (top 5 rows)
 * @param {sql.ConnectionPool} pool - Database connection pool
 * @param {string} tableName - Name of the table
 * @returns {Promise<Array>} Array of sample data objects
 */
async function getSampleData(pool, tableName) {
    try {
        // First check if table has any data
        const countResult = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(`SELECT COUNT(*) as count FROM ${tableName}`);
        
        if (countResult.recordset[0].count === 0) {
            return []; // Return empty array if table has no data
        }
        
        const result = await pool.request()
            .input('tableName', sql.NVarChar, tableName)
            .query(`SELECT TOP 5 * FROM ${tableName}`);
        
        return result.recordset;
    } catch (error) {
        console.error(`Error getting sample data for table ${tableName}:`, error);
        // Return empty array instead of throwing to continue with other tables
        return [];
    }
}

/**
 * Format column type with precision/scale for better readability
 * @param {Object} column - Column object with type information
 * @returns {string} Formatted column type string
 */
function formatColumnType(column) {
    let typeStr = column.type;
    
    if (column.type === 'varchar' || column.type === 'nvarchar' || column.type === 'char' || column.type === 'nchar') {
        if (column.maxLength === -1) {
            typeStr += '(MAX)';
        } else if (column.maxLength) {
            typeStr += `(${column.maxLength})`;
        }
    } else if (column.type === 'decimal' || column.type === 'numeric') {
        if (column.precision && column.scale !== null) {
            typeStr += `(${column.precision},${column.scale})`;
        }
    } else if (column.type === 'float' || column.type === 'real') {
        if (column.precision) {
            typeStr += `(${column.precision})`;
        }
    }
    
    return typeStr;
}

/**
 * Get complete database context including all tables, columns, and sample data
 * @param {sql.ConnectionPool} pool - Database connection pool
 * @returns {Promise<Object>} Structured database context object
 */
async function getDatabaseContext(pool) {
    try {
        console.log('🔍 Starting database schema introspection...');
        
        // Get all user tables
        const tableNames = await getUserTables(pool);
        console.log(`📋 Found ${tableNames.length} user tables:`, tableNames);
        
        const databaseContext = {
            tables: [],
            totalTables: tableNames.length,
            introspectionTime: new Date().toISOString()
        };
        
        // Process each table
        for (const tableName of tableNames) {
            console.log(`📊 Processing table: ${tableName}`);
            
            try {
                // Get columns for this table
                const columns = await getTableColumns(pool, tableName);
                
                // Get sample data for this table
                const sampleData = await getSampleData(pool, tableName);
                
                // Create table object
                const tableInfo = {
                    tableName: tableName,
                    columns: columns.map(col => ({
                        name: col.name,
                        type: formatColumnType(col),
                        nullable: col.nullable
                    })),
                    sampleData: sampleData,
                    columnCount: columns.length,
                    sampleDataCount: sampleData.length
                };
                
                databaseContext.tables.push(tableInfo);
                
                console.log(`✅ Processed ${tableName}: ${columns.length} columns, ${sampleData.length} sample rows`);
                
            } catch (error) {
                console.error(`❌ Error processing table ${tableName}:`, error.message);
                // Continue with other tables even if one fails
                databaseContext.tables.push({
                    tableName: tableName,
                    columns: [],
                    sampleData: [],
                    columnCount: 0,
                    sampleDataCount: 0,
                    error: error.message
                });
            }
        }
        
        console.log('🎉 Database schema introspection completed successfully');
        return databaseContext;
        
    } catch (error) {
        console.error('❌ Error in database introspection:', error);
        throw new Error(`Database introspection failed: ${error.message}`);
    }
}

/**
 * Build a clean prompt string from database context and user question
 * @param {string} userQuestion - The user's question
 * @param {Object} dbContext - Database context object from getDatabaseContext()
 * @returns {string} Formatted prompt string for LLM
 */
function buildPrompt(userQuestion, dbContext) {
    if (!dbContext || !dbContext.tables) {
        throw new Error('Invalid database context provided');
    }
    
    let prompt = `You are an expert SQL Server database analyst. Your task is to understand natural language questions and convert them into precise, efficient SQL queries.

DATABASE SCHEMA:

`;
    
    // Add each table's schema information
    dbContext.tables.forEach(table => {
        if (table.error) {
            // Skip tables that had errors during introspection
            return;
        }
        
        // Format column list
        const columnList = table.columns.map(col => col.name).join(', ');
        prompt += `- ${table.tableName}(${columnList})\n`;
        
        // Add sample data if available (1-2 rows)
        if (table.sampleData && table.sampleData.length > 0) {
            prompt += `  Sample data:\n`;
            const sampleRows = table.sampleData.slice(0, 2); // Limit to 2 rows
            
            sampleRows.forEach((row, index) => {
                const rowData = Object.entries(row)
                    .map(([key, value]) => {
                        if (value === null) return `${key}: NULL`;
                        if (typeof value === 'string') return `${key}: '${value}'`;
                        return `${key}: ${value}`;
                    })
                    .join(', ');
                prompt += `    Row ${index + 1}: {${rowData}}\n`;
            });
        }
        prompt += `\n`;
    });
    
    // Add user question
    prompt += `USER QUESTION: "${userQuestion}"

IMPORTANT GUIDELINES:
- Always filter out deleted records: WHERE IsDeleted = 0 OR IsDeleted IS NULL
- Use meaningful column aliases for clarity
- Only use SELECT statements (no INSERT, UPDATE, DELETE)
- Use TOP clauses for large result sets
- Always qualify table names to avoid ambiguity

TASK: Generate a single, optimized SQL query that best answers the user's question. Return ONLY the SQL query wrapped in \`\`\`sql blocks.`;
    
    return prompt;
}

/**
 * Get database context and build prompt in one function
 * @param {sql.ConnectionPool} pool - Database connection pool
 * @param {string} userQuestion - The user's question
 * @returns {Promise<Object>} Object containing both dbContext and prompt
 */
async function getContextAndBuildPrompt(pool, userQuestion) {
    try {
        const dbContext = await getDatabaseContext(pool);
        const prompt = buildPrompt(userQuestion, dbContext);
        
        return {
            dbContext,
            prompt,
            success: true
        };
    } catch (error) {
        console.error('Error in getContextAndBuildPrompt:', error);
        return {
            dbContext: null,
            prompt: null,
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    getDatabaseContext,
    buildPrompt,
    getContextAndBuildPrompt,
    getUserTables,
    getTableColumns,
    getSampleData
}; 