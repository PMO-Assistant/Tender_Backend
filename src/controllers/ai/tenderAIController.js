const { getConnectedPool } = require('../../config/database');
const mistralService = require('../../config/mistralAIService');
const { getContextAndBuildPrompt } = require('../../utils/databaseIntrospection');
const { askTenderAI } = require('../../utils/askTenderAI');

/**
 * Escape user input to prevent prompt injection
 * @param {string} text 
 * @returns {string}
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
 * Remove blocos ```sql e ``` do texto gerado pela IA
 * @param {string} text 
 * @returns {string}
 */
function cleanGeneratedQuery(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    let cleaned = text
        .replace(/```sql\n?/gi, '')  // remove abertura ```sql
        .replace(/```\n?/gi, '')     // remove fechamento ```
        .trim();
    
    // Normalize whitespace and newlines
    cleaned = cleaned
        .replace(/\r\n/g, '\n')      // normalize line endings
        .replace(/\r/g, '\n')        // normalize line endings
        .replace(/\n+/g, ' ')        // replace multiple newlines with single space
        .replace(/\s+/g, ' ')        // replace multiple spaces with single space
        .trim();
    
    console.log('🧹 Cleaned query:', cleaned);
    return cleaned;
}

/**
 * Add IsDeleted filter to SQL query if missing
 * @param {string} sql 
 * @returns {string}
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
 * Validate SQL query for security and syntax
 * @param {string} sql 
 * @returns {boolean}
 */
function validateSQLQuery(sql) {
    if (!sql || typeof sql !== 'string') {
        console.log('❌ Validation failed: SQL is null or not a string');
        return false;
    }
    
    const upperSql = sql.toUpperCase();
    console.log('🔍 Validating SQL:', upperSql);
    
    // Only allow SELECT and WITH statements
    if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH')) {
        console.log('❌ Validation failed: SQL does not start with SELECT or WITH');
        return false;
    }
    
    // Block dangerous operations - use word boundaries to avoid false positives
    const dangerousKeywords = [
        'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'EXEC', 'EXECUTE',
        'TRUNCATE', 'BACKUP', 'RESTORE', 'GRANT', 'REVOKE', 'DENY'
    ];
    
    for (const keyword of dangerousKeywords) {
        // Use word boundaries to match whole words only
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(upperSql)) {
            console.log(`❌ Validation failed: Contains dangerous keyword: ${keyword}`);
            return false;
        }
    }
    
    console.log('✅ SQL validation passed');
    return true;
}

/**
 * Get fallback query based on question type
 * @param {string} question 
 * @returns {string}
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
 * @param {Object} logData 
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
    
    // In production, you might want to store this in a database
    // For now, we'll log to console with sanitized data
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
 * Build prompt using introspection (if enabled) or fallback to hardcoded schema
 * @param {string} question - User question
 * @param {sql.ConnectionPool} pool - Database connection pool
 * @param {boolean} useIntrospection - Whether to use database introspection
 * @returns {Promise<string>} Generated prompt
 */
async function buildPromptWithIntrospection(question, pool, useIntrospection = false) {
    if (useIntrospection) {
        try {
            console.log('🔍 Using database introspection for prompt generation...');
            const { prompt, success } = await getContextAndBuildPrompt(pool, question);
            
            if (success && prompt) {
                console.log('✅ Successfully generated prompt using introspection');
                return prompt;
            } else {
                console.log('⚠️ Introspection failed, falling back to hardcoded schema');
            }
        } catch (error) {
            console.error('❌ Error in introspection:', error.message);
            console.log('⚠️ Falling back to hardcoded schema');
        }
    }
    
    // Fallback to hardcoded schema
    const escapedQuestion = escapeUserInput(question);
    
    return `You are an expert SQL Server database analyst specializing in tender management systems. Your task is to understand natural language questions and convert them into precise, efficient SQL queries.

CONTEXT: This is a tender management system where companies bid on construction and development projects.

USER QUESTION: "${escapedQuestion}"

DATABASE SCHEMA:

Core Tables:
- tenderTender(TenderID, KeyContact, AddBy, ProjectName, OpenDate, ApplyTo, Value, ReturnDate, Status, Type, Source, ManagingTender, Consultant, Notes, CreatedAt, UpdatedAt, IsDeleted, DeletedAt)
- tenderContact(ContactID, CompanyID, AddBy, FirstName, Surname, Phone, Email, Status, CreatedAt, UpdatedAt, IsDeleted, DeletedAt)
- tenderCompany(CompanyID, AddBy, Name, Phone, Email, CreatedAt, UpdatedAt)
- tenderEmployee(UserID, LastLogin, Name, Email)

Key Relationships:
- tenderTender.KeyContact → tenderContact.ContactID
- tenderContact.CompanyID → tenderCompany.CompanyID
- tenderTender.AddBy → tenderEmployee.UserID (IMPORTANT: AddBy stores UserID)
- tenderContact.AddBy → tenderEmployee.UserID
- tenderCompany.AddBy → tenderEmployee.UserID

CRITICAL UNDERSTANDING:
- When user asks "biggest" or "largest" → ALWAYS use SELECT TOP 1 and ORDER BY Value DESC
- When user mentions a specific type (pharma, new-build, fit-out, etc.) → ALWAYS filter by Type = '[type]'
- When user asks "biggest [type] tender" → Combine both: TOP 1 + Type filter + ORDER BY Value DESC
- When user asks "show me all" → Use SELECT TOP 20 and ORDER BY CreatedAt DESC

EXAMPLES:
- "What's the biggest pharma tender?" → SELECT TOP 1 ProjectName, Value, Status, Type FROM tenderTender WHERE IsDeleted = 0 AND Type = 'Pharma' ORDER BY Value DESC
- "What's the biggest New Build tender?" → SELECT TOP 1 ProjectName, Value, Status, Type FROM tenderTender WHERE IsDeleted = 0 AND Type = 'New-Build' ORDER BY Value DESC
- "Show me all tenders" → SELECT TOP 20 ProjectName, Value, Status, Type FROM tenderTender WHERE IsDeleted = 0 ORDER BY CreatedAt DESC
- "What's the biggest tender?" → SELECT TOP 1 ProjectName, Value, Status, Type FROM tenderTender WHERE IsDeleted = 0 ORDER BY Value DESC

IMPORTANT GUIDELINES:
1. **PRIORITIZE USER INTENT**: Always focus on the specific question asked, not generic responses
   - If user asks for "biggest" or "largest" → ALWAYS use TOP 1 with ORDER BY Value DESC
   - If user asks for specific type (e.g., "Pharma", "New Build") → ALWAYS filter by Type = '[type]'
   - If user asks for "all" → Show all results with TOP 20
   - If user asks for "recent" → Use ORDER BY CreatedAt DESC with TOP 10-20

2. **Query Intelligence**: Understand the intent behind the question
   - "biggest" or "largest" → ORDER BY Value DESC LIMIT 1
   - "recent" or "latest" → ORDER BY CreatedAt DESC
   - "count" or "how many" → COUNT() with GROUP BY
   - "active" → WHERE Status = 'active' OR IsDeleted = 0
   - "by type" or "grouped by" → GROUP BY with COUNT()
   - "users" or "employees" → Use tenderEmployee table
   - "contacts" → Use tenderContact table
   - "companies" → Use tenderCompany table
   - "added by [name]" or "[name] added" → JOIN tenderTender.AddBy with tenderEmployee.UserID WHERE tenderEmployee.Name LIKE '%name%'
   - "tenders by [user]" → JOIN tables to find tenders by specific user

3. **Data Quality**: 
   - Always filter out deleted records: WHERE IsDeleted = 0 OR IsDeleted IS NULL
   - Use meaningful column aliases for clarity (e.g., Type AS TenderType, COUNT(*) AS TenderCount)
   - Format currency values properly
   - Include relevant dates when available

4. **Performance & Safety**:
   - Use TOP clauses for "biggest" or "largest" queries
   - Limit results to prevent overwhelming responses
   - Only use SELECT statements (no INSERT, UPDATE, DELETE)
   - Always qualify table names to avoid ambiguity

5. **Common Query Patterns**:
   - For "biggest tender": SELECT TOP 1 ProjectName, Value, Status, Type, OpenDate FROM tenderTender WHERE IsDeleted = 0 ORDER BY Value DESC
   - For "biggest [type] tender": SELECT TOP 1 ProjectName, Value, Status, Type, OpenDate FROM tenderTender WHERE IsDeleted = 0 AND Type = '[type]' ORDER BY Value DESC
   - For "recent contacts": SELECT TOP 10 FirstName, Surname, Company, CreatedAt FROM tenderContact WHERE IsDeleted = 0 ORDER BY CreatedAt DESC
   - For "count by type": SELECT Type AS TenderType, COUNT(*) AS TenderCount FROM tenderTender WHERE IsDeleted = 0 GROUP BY Type ORDER BY TenderCount DESC
   - For "how many tenders": SELECT COUNT(*) AS TotalTenders FROM tenderTender WHERE IsDeleted = 0
   - For "tenders by status": SELECT Status AS TenderStatus, COUNT(*) AS TenderCount FROM tenderTender WHERE IsDeleted = 0 GROUP BY Status ORDER BY TenderCount DESC
   - For "how many users": SELECT COUNT(*) AS TotalUsers FROM tenderEmployee
   - For "how many contacts": SELECT COUNT(*) AS TotalContacts FROM tenderContact WHERE IsDeleted = 0
   - For "how many companies": SELECT COUNT(*) AS TotalCompanies FROM tenderCompany
   - For "show me all users": SELECT TOP 20 UserID, Name, Email, LastLogin FROM tenderEmployee ORDER BY LastLogin DESC
   - For "show me all contacts": SELECT TOP 20 FirstName, Surname, Email, Phone, Status FROM tenderContact WHERE IsDeleted = 0 ORDER BY CreatedAt DESC
   - For "show me all companies": SELECT TOP 20 Name, Phone, Email FROM tenderCompany ORDER BY CreatedAt DESC
   - For "show me all tenders": SELECT TOP 20 ProjectName, Value, Status, Type, OpenDate FROM tenderTender WHERE IsDeleted = 0 ORDER BY CreatedAt DESC
   - For "tenders added by [name]": SELECT t.ProjectName, t.Value, t.Status, t.Type, t.OpenDate, e.Name AS AddedBy FROM tenderTender t JOIN tenderEmployee e ON t.AddBy = e.UserID WHERE t.IsDeleted = 0 AND e.Name LIKE '%[name]%' ORDER BY t.CreatedAt DESC
   - For "tenders by user": SELECT t.ProjectName, t.Value, t.Status, t.Type, t.OpenDate, e.Name AS AddedBy FROM tenderTender t JOIN tenderEmployee e ON t.AddBy = e.UserID WHERE t.IsDeleted = 0 ORDER BY t.CreatedAt DESC

6. **Smart Column Aliasing**:
   - Always use descriptive aliases: Type AS TenderType, COUNT(*) AS TenderCount, Status AS TenderStatus
   - For counts: use TenderCount, TotalCount, or NumberOfTenders
   - For categories: use TenderType, Category, or Type
   - For status: use TenderStatus, CurrentStatus, or Status
   - For user relationships: use AddedBy, CreatedBy, or UserName

7. **JOIN Patterns for User Relationships**:
   - When user name is mentioned: JOIN tenderTender t JOIN tenderEmployee e ON t.AddBy = e.UserID WHERE e.Name LIKE '%[name]%'
   - When user ID is mentioned: JOIN tenderTender t JOIN tenderEmployee e ON t.AddBy = e.UserID WHERE e.UserID = [id]
   - For all tenders with user info: SELECT t.*, e.Name AS AddedBy FROM tenderTender t JOIN tenderEmployee e ON t.AddBy = e.UserID

CRITICAL: When asked about "biggest" or "largest" tenders, ALWAYS use this exact query pattern:
SELECT TOP 1 ProjectName, Value, Status, Type, OpenDate 
FROM tenderTender 
WHERE (IsDeleted = 0 OR IsDeleted IS NULL) 
ORDER BY Value DESC

CRITICAL: When asked about "biggest [type]" tenders, ALWAYS use this exact query pattern:
SELECT TOP 1 ProjectName, Value, Status, Type, OpenDate 
FROM tenderTender 
WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Type = '[type]'
ORDER BY Value DESC

CRITICAL: Return ONLY the SQL query, no explanations, no comments, no additional text. Just the SQL query wrapped in \`\`\`sql blocks.

TASK: Generate a single, optimized SQL query that best answers the user's question. Return ONLY the SQL query wrapped in \`\`\`sql blocks.

Remember: Focus on the most relevant information for the user's question and use clear, descriptive column aliases. DO NOT include any explanatory text or comments in your response.`;
}

/**
 * POST /api/ai/ask
 * Request body: { question: string, useIntrospection?: boolean, useNewModule?: boolean }
 */
const askTenderAIController = async (req, res) => {
    const startTime = Date.now();
    const { question, useIntrospection = false, useNewModule = false } = req.body;

    if (!question || question.trim() === '') {
        return res.status(400).json({ error: 'Question is required.' });
    }

    try {
        // Option 1: Use the new askTenderAI module
        if (useNewModule) {
            console.log('🆕 Using new askTenderAI module...');
            
            const pool = await getConnectedPool();
            
            // Get database context for the new module
            const { getDatabaseContext } = require('../../utils/databaseIntrospection');
            const dbContext = await getDatabaseContext(pool);
            
            // Use the new module
            const result = await askTenderAI(question, dbContext);
            
            if (result.success) {
                return res.json({
                    question,
                    query: result.query,
                    result: result.data,
                    fallbackUsed: result.fallbackUsed
                });
            } else {
                return res.status(400).json({
                    error: result.error,
                    question: question
                });
            }
        }
        
        // Option 2: Use existing implementation
        console.log('🔄 Using existing implementation...');
        
        // Step 1: Build prompt using introspection or hardcoded schema
        const pool = await getConnectedPool();
        const escapedQuestion = escapeUserInput(question);
        const prompt = await buildPromptWithIntrospection(escapedQuestion, pool, useIntrospection);

        console.log('🤖 Original question:', question);
        console.log('🤖 Question being sent to AI:', escapedQuestion);
        console.log('📝 Prompt length:', prompt.length, 'characters');

        const { generated_query } = await mistralService.query(prompt);

        console.log('🤖 Generated SQL:', generated_query);

        // Step 2: Clean and validate query
        const cleanedQuery = cleanGeneratedQuery(generated_query);

        console.log('🧹 Cleaned SQL:', cleanedQuery);

        // Additional validation to ensure we have a proper SQL query
        if (!cleanedQuery || cleanedQuery.trim() === '') {
            const logData = {
                originalQuestion: question,
                generatedSQL: generated_query,
                cleanedSQL: cleanedQuery,
                resultCount: 0,
                fallbackUsed: false,
                success: false,
                error: 'No valid SQL query generated',
                executionTime: Date.now() - startTime
            };
            logQueryExecution(logData);
            
            return res.status(400).json({
                error: 'No valid SQL query generated. Please try rephrasing your question.',
                question: question
            });
        }

        if (!validateSQLQuery(cleanedQuery)) {
            console.log('❌ SQL validation failed for query:', cleanedQuery);
            const logData = {
                originalQuestion: question,
                generatedSQL: generated_query,
                cleanedSQL: cleanedQuery,
                resultCount: 0,
                fallbackUsed: false,
                success: false,
                error: 'Invalid SQL query',
                executionTime: Date.now() - startTime
            };
            logQueryExecution(logData);
            
            return res.status(400).json({
                error: 'Invalid query format. Please try rephrasing your question.',
                generatedQuery: cleanedQuery
            });
        }

        console.log('✅ SQL validation passed, proceeding with execution');

        // Check for common SQL syntax issues
        if (cleanedQuery.toLowerCase().includes('this query') || 
            cleanedQuery.toLowerCase().includes('explanation') ||
            cleanedQuery.toLowerCase().includes('the query')) {
            const logData = {
                originalQuestion: question,
                generatedSQL: generated_query,
                cleanedSQL: cleanedQuery,
                resultCount: 0,
                fallbackUsed: false,
                success: false,
                error: 'Invalid query format',
                executionTime: Date.now() - startTime
            };
            logQueryExecution(logData);
            
            return res.status(400).json({
                error: 'Invalid query format. Please try rephrasing your question.',
                generatedQuery: cleanedQuery
            });
        }

        // Step 3: Inject IsDeleted filter if missing
        const finalQuery = injectIsDeletedFilter(cleanedQuery);

        // Step 4: Execute the query
        console.log('🔍 Executing query:', finalQuery);
        
        let result;
        let fallbackUsed = false;
        
        try {
            result = await pool.request().query(finalQuery);
        } catch (queryError) {
            console.log('❌ Query failed, trying fallback query...');
            fallbackUsed = true;
            
            // Get appropriate fallback query
            const fallbackQuery = getFallbackQuery(question);
            console.log('🔄 Using fallback query:', fallbackQuery);
            
            try {
                result = await pool.request().query(fallbackQuery);
            } catch (fallbackError) {
                const logData = {
                    originalQuestion: question,
                    generatedSQL: generated_query,
                    cleanedSQL: finalQuery,
                    resultCount: 0,
                    fallbackUsed: true,
                    success: false,
                    error: fallbackError.message,
                    executionTime: Date.now() - startTime
                };
                logQueryExecution(logData);
                
                throw fallbackError;
            }
        }
        
        console.log('📊 Query result:', result.recordset);

        // Log successful execution
        const logData = {
            originalQuestion: question,
            generatedSQL: generated_query,
            cleanedSQL: finalQuery,
            resultCount: result.recordset.length,
            fallbackUsed: fallbackUsed,
            success: true,
            error: null,
            executionTime: Date.now() - startTime
        };
        logQueryExecution(logData);

        return res.json({
            question,
            query: finalQuery,
            result: result.recordset,
            fallbackUsed: fallbackUsed
        });

    } catch (err) {
        const executionTime = Date.now() - startTime;
        
        // Production-safe error logging
        if (process.env.NODE_ENV === 'production') {
            console.error('❌ Error in askTenderAI:', {
                error: err.message,
                question: question,
                executionTime: executionTime
            });
        } else {
            console.error('❌ Error in askTenderAI:', err);
        }
        
        const logData = {
            originalQuestion: question,
            generatedSQL: null,
            cleanedSQL: null,
            resultCount: 0,
            fallbackUsed: false,
            success: false,
            error: err.message,
            executionTime: executionTime
        };
        logQueryExecution(logData);
        
        return res.status(500).json({
            error: 'Failed to process the request.',
            details: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
        });
    }
};

module.exports = {
    askTenderAIController
};
