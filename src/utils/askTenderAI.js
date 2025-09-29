const sql = require('mssql');
const { getConnectedPool } = require('../config/database');
const openAIService = require('../config/openAIService');
const { buildPrompt } = require('./databaseIntrospection');

/**
 * AskTenderAI Module
 * 
 * This module provides a clean interface for asking natural language questions
 * about the database and getting SQL query results.
 */

/**
 * Escape user input to prevent prompt injection
 * @param {string} text - User input to escape
 * @returns {string} Escaped text
 */
function escapeUserInput(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')    // Escape double quotes
        .replace(/'/g, "\\'")    // Escape single quotes
        .replace(/\n/g, '\\n')   // Escape newlines
        .replace(/\r/g, '\\r')   // Escape carriage returns
        .replace(/\t/g, '\\t');  // Escape tabs
}

/**
 * Clean generated SQL query by removing markdown blocks and dangerous content
 * @param {string} text - Raw response from LLM
 * @returns {string} Cleaned SQL query
 */
function cleanGeneratedQuery(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Remove markdown code blocks
    let cleaned = text
        .replace(/```sql\n?/gi, '')  // Remove opening ```sql
        .replace(/```\n?/gi, '')     // Remove closing ```
        .replace(/`/g, '')           // Remove any remaining backticks
        .trim();
    
    // Remove common explanatory text that might appear before/after SQL
    const dangerousPatterns = [
        /^here's the sql query:\s*/i,
        /^the query is:\s*/i,
        /^sql query:\s*/i,
        /^query:\s*/i,
        /\s*this query will.*$/i,
        /\s*the above query.*$/i,
        /\s*this sql.*$/i
    ];
    
    dangerousPatterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });
    
    return cleaned.trim();
}

/**
 * Validate SQL query for security and syntax
 * @param {string} sql - SQL query to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateSQLQuery(sql) {
    if (!sql || typeof sql !== 'string') {
        return false;
    }
    
    const upperSql = sql.toUpperCase();
    
    // Only allow SELECT and WITH statements
    if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH')) {
        return false;
    }
    
    // Block dangerous operations
    const dangerousKeywords = [
        'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'EXEC', 'EXECUTE',
        'TRUNCATE', 'BACKUP', 'RESTORE', 'GRANT', 'REVOKE', 'DENY', 'MERGE',
        'BULK INSERT', 'OPENROWSET', 'OPENQUERY', 'EXECUTE AS'
    ];
    
    for (const keyword of dangerousKeywords) {
        if (upperSql.includes(keyword)) {
            return false;
        }
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
        /;\s*$/,           // Ends with semicolon
        /;\s*--/,          // Semicolon followed by comment
        /;\s*\/\*/,        // Semicolon followed by block comment
        /;\s*[A-Z]/,       // Semicolon followed by uppercase (potential command)
    ];
    
    for (const pattern of suspiciousPatterns) {
        if (pattern.test(upperSql)) {
            return false;
        }
    }
    
    return true;
}

/**
 * Add IsDeleted filter to SQL query if missing
 * @param {string} sql - Original SQL query
 * @returns {string} SQL query with IsDeleted filter
 */
function injectIsDeletedFilter(sql) {
    const upperSql = sql.toUpperCase();
    
    // If query already has IsDeleted filter, return as is
    if (upperSql.includes('ISDELETED = 0') || upperSql.includes('ISDELETED IS NULL')) {
        return sql;
    }
    
    // If query has WHERE clause, add IsDeleted condition
    if (upperSql.includes('WHERE')) {
        return sql.replace(/WHERE/gi, 'WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND');
    }
    
    // If query has no WHERE clause, add one
    return sql + ' WHERE (IsDeleted = 0 OR IsDeleted IS NULL)';
}

/**
 * Get fallback query based on question type
 * @param {string} question - User question
 * @returns {string} Fallback SQL query
 */
function getFallbackQuery(question) {
    const lowerQuestion = question.toLowerCase();
    
    if (lowerQuestion.includes('biggest') || lowerQuestion.includes('largest')) {
        return `SELECT TOP 1 ProjectName, Value, Status, Type, OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY Value DESC`;
    }
    
    if (lowerQuestion.includes('recent') || lowerQuestion.includes('latest')) {
        return `SELECT TOP 10 ProjectName, Value, Status, Type, CreatedAt FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY CreatedAt DESC`;
    }
    
    if (lowerQuestion.includes('count') || lowerQuestion.includes('how many')) {
        if (lowerQuestion.includes('user')) {
            return `SELECT COUNT(*) AS TotalUsers FROM tenderEmployee`;
        }
        if (lowerQuestion.includes('contact')) {
            return `SELECT COUNT(*) AS TotalContacts FROM tenderContact WHERE (IsDeleted = 0 OR IsDeleted IS NULL)`;
        }
        if (lowerQuestion.includes('company')) {
            return `SELECT COUNT(*) AS TotalCompanies FROM tenderCompany`;
        }
        return `SELECT COUNT(*) AS TotalTenders FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL)`;
    }
    
    if (lowerQuestion.includes('user')) {
        return `SELECT TOP 20 UserID, Name, Email, LastLogin FROM tenderEmployee ORDER BY LastLogin DESC`;
    }
    
    if (lowerQuestion.includes('contact')) {
        return `SELECT TOP 20 FirstName, Surname, Email, Phone, Status FROM tenderContact WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY CreatedAt DESC`;
    }
    
    if (lowerQuestion.includes('company')) {
        return `SELECT TOP 20 Name, Phone, Email FROM tenderCompany ORDER BY CreatedAt DESC`;
    }
    
    // Default fallback
    return `SELECT TOP 10 ProjectName, Value, Status, Type, OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY CreatedAt DESC`;
}

/**
 * Log query execution details
 * @param {Object} logData - Log data object
 */
function logQueryExecution(logData) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        originalQuestion: logData.originalQuestion,
        generatedSQL: logData.generatedSQL,
        cleanedSQL: logData.cleanedSQL,
        resultCount: logData.resultCount,
        fallbackUsed: logData.fallbackUsed,
        success: logData.success,
        error: logData.error || null,
        executionTime: logData.executionTime
    };
    
    // Console logging with sanitized data
    console.log('🔍 Query Execution Log:', {
        timestamp: logEntry.timestamp,
        question: logEntry.originalQuestion,
        resultCount: logEntry.resultCount,
        fallbackUsed: logEntry.fallbackUsed,
        success: logEntry.success,
        executionTime: logEntry.executionTime
    });
    
    // In development, log more details
    if (process.env.NODE_ENV === 'development') {
        console.log('🔍 Full Query Log:', logEntry);
    }
}

/**
 * Main function to ask questions about the database
 * @param {string} userQuestion - User's natural language question
 * @param {Object} dbContext - Database context object from introspection
 * @returns {Promise<Object>} Result object with data or error
 */
async function askTenderAI(userQuestion, dbContext) {
    const startTime = Date.now();
    
    // Input validation
    if (!userQuestion || typeof userQuestion !== 'string' || userQuestion.trim() === '') {
        return {
            success: false,
            error: 'Question is required and must be a non-empty string.',
            data: null,
            fallbackUsed: false
        };
    }
    
    if (!dbContext || !dbContext.tables || !Array.isArray(dbContext.tables)) {
        return {
            success: false,
            error: 'Invalid database context provided.',
            data: null,
            fallbackUsed: false
        };
    }
    
    try {
        // Step 1: Build prompt using the provided dbContext
        const escapedQuestion = escapeUserInput(userQuestion);
        const prompt = buildPrompt(escapedQuestion, dbContext);
        
        console.log('🤖 Sending question to LLM:', userQuestion);
        
        // Step 2: Send to LLM
        const { generated_query } = await openAIService.query(prompt);
        
        console.log('📝 Raw LLM response:', generated_query);
        
        // Step 3: Clean and validate the generated SQL
        const cleanedQuery = cleanGeneratedQuery(generated_query);
        
        console.log('🧹 Cleaned SQL:', cleanedQuery);
        
        // Additional validation
        if (!cleanedQuery || cleanedQuery.trim() === '') {
            const logData = {
                originalQuestion: userQuestion,
                generatedSQL: generated_query,
                cleanedSQL: cleanedQuery,
                resultCount: 0,
                fallbackUsed: false,
                success: false,
                error: 'No valid SQL query generated',
                executionTime: Date.now() - startTime
            };
            logQueryExecution(logData);
            
            return {
                success: false,
                error: 'Sorry, I couldn\'t generate a valid SQL query for your question. Please try rephrasing.',
                data: null,
                fallbackUsed: false
            };
        }
        
        if (!validateSQLQuery(cleanedQuery)) {
            const logData = {
                originalQuestion: userQuestion,
                generatedSQL: generated_query,
                cleanedSQL: cleanedQuery,
                resultCount: 0,
                fallbackUsed: false,
                success: false,
                error: 'Invalid SQL query format',
                executionTime: Date.now() - startTime
            };
            logQueryExecution(logData);
            
            return {
                success: false,
                error: 'Sorry, I couldn\'t generate a safe SQL query for your question. Please try rephrasing.',
                data: null,
                fallbackUsed: false
            };
        }
        
        // Step 4: Inject IsDeleted filter if missing
        const finalQuery = injectIsDeletedFilter(cleanedQuery);
        
        // Step 5: Execute the query
        console.log('🔍 Executing query:', finalQuery);
        
        const pool = await getConnectedPool();
        let result;
        let fallbackUsed = false;
        
        try {
            result = await pool.request().query(finalQuery);
        } catch (queryError) {
            console.log('❌ Query failed, trying fallback query...');
            fallbackUsed = true;
            
            // Get appropriate fallback query
            const fallbackQuery = getFallbackQuery(userQuestion);
            console.log('🔄 Using fallback query:', fallbackQuery);
            
            try {
                result = await pool.request().query(fallbackQuery);
            } catch (fallbackError) {
                const logData = {
                    originalQuestion: userQuestion,
                    generatedSQL: generated_query,
                    cleanedSQL: finalQuery,
                    resultCount: 0,
                    fallbackUsed: true,
                    success: false,
                    error: fallbackError.message,
                    executionTime: Date.now() - startTime
                };
                logQueryExecution(logData);
                
                return {
                    success: false,
                    error: 'Sorry, I couldn\'t answer that question. Please try rephrasing or ask something else.',
                    data: null,
                    fallbackUsed: true
                };
            }
        }
        
        console.log('📊 Query result count:', result.recordset.length);
        
        // Log successful execution
        const logData = {
            originalQuestion: userQuestion,
            generatedSQL: generated_query,
            cleanedSQL: finalQuery,
            resultCount: result.recordset.length,
            fallbackUsed: fallbackUsed,
            success: true,
            error: null,
            executionTime: Date.now() - startTime
        };
        logQueryExecution(logData);
        
        return {
            success: true,
            data: result.recordset,
            fallbackUsed: fallbackUsed,
            query: finalQuery,
            resultCount: result.recordset.length
        };
        
    } catch (error) {
        const executionTime = Date.now() - startTime;
        
        // Production-safe error logging
        if (process.env.NODE_ENV === 'production') {
            console.error('❌ Error in askTenderAI:', {
                error: error.message,
                question: userQuestion,
                executionTime: executionTime
            });
        } else {
            console.error('❌ Error in askTenderAI:', error);
        }
        
        const logData = {
            originalQuestion: userQuestion,
            generatedSQL: null,
            cleanedSQL: null,
            resultCount: 0,
            fallbackUsed: false,
            success: false,
            error: error.message,
            executionTime: executionTime
        };
        logQueryExecution(logData);
        
        return {
            success: false,
            error: 'Sorry, I encountered an error while processing your question. Please try again.',
            data: null,
            fallbackUsed: false
        };
    }
}

module.exports = {
    askTenderAI,
    escapeUserInput,
    cleanGeneratedQuery,
    validateSQLQuery,
    injectIsDeletedFilter,
    getFallbackQuery,
    logQueryExecution
}; 