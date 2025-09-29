const { getConnectedPool } = require('../../config/database');
const openAIService = require('../../config/openAIService');
console.log('[AI] Using OpenAI service');
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
 * Validate SQL syntax to prevent malformed queries
 */
function isValidSQLSyntax(query) {
    // Remove extra whitespace and normalize
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();
    
    // Check for common SQL syntax errors
    const syntaxErrors = [
        /ORDER BY\s+\w+\s*;\s*WHERE/i,  // ORDER BY Name; WHERE
        /SELECT\s+.*;\s*WHERE/i,        // SELECT ...; WHERE
        /FROM\s+.*;\s*WHERE/i,          // FROM ...; WHERE
        /GROUP BY\s+.*;\s*WHERE/i,      // GROUP BY ...; WHERE
        /HAVING\s+.*;\s*WHERE/i,       // HAVING ...; WHERE
        /;\s*WHERE/i,                   // Any semicolon before WHERE
        /WHERE\s+.*;\s*WHERE/i,        // WHERE ...; WHERE
        /WHERE\s+.*;\s*ORDER/i,         // WHERE ...; ORDER
        /WHERE\s+.*;\s*GROUP/i,        // WHERE ...; GROUP
        /WHERE\s+.*;\s*HAVING/i,       // WHERE ...; HAVING
    ];
    
    // Check if query contains any syntax errors
    for (const errorPattern of syntaxErrors) {
        if (errorPattern.test(normalizedQuery)) {
            console.log('❌ SQL syntax error detected:', errorPattern.source);
            return false;
        }
    }
    
    // Basic validation - must start with SELECT
    if (!normalizedQuery.toUpperCase().startsWith('SELECT')) {
        console.log('❌ Query does not start with SELECT');
        return false;
    }
    
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
        if (lowerQuestion.includes('approved') && (lowerQuestion.includes('2024') || lowerQuestion.includes('this year'))) {
            // Be flexible with both status AND date columns for temporal queries
            return `SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Status IN ('Approved', 'Active', 'Won', 'Awarded', 'Completed', 'Successful', 'Accepted', 'Confirmed', 'Finalized', 'Closed', 'Done', 'Finished', 'Delivered', 'Executed') AND (YEAR(OpenDate) = 2024 OR YEAR(CreatedAt) = 2024) ORDER BY Value DESC`;
        }
        if (lowerQuestion.includes('approved')) {
            // Be VERY flexible with status values - try many possible positive statuses
            return `SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Status IN ('Approved', 'Active', 'Won', 'Awarded', 'Completed', 'Successful', 'Accepted', 'Confirmed', 'Finalized', 'Closed', 'Done', 'Finished', 'Delivered', 'Executed') ORDER BY Value DESC`;
        }
        if (lowerQuestion.includes('pharma')) {
            return `SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Type = 'Pharma' ORDER BY Value DESC`;
        }
        if (lowerQuestion.includes('new build') || lowerQuestion.includes('new-build')) {
            return `SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Type = 'New-Build' ORDER BY Value DESC`;
        }
        return `SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY Value DESC`;
    }
    
    if (lowerQuestion.includes('recent') || lowerQuestion.includes('latest')) {
        return `SELECT TOP 10 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, CreatedAt AS CreatedAt FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY CreatedAt DESC`;
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
        if (lowerQuestion.includes('approved')) {
            return `SELECT COUNT(*) AS TotalApprovedTenders FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND (Status = 'Approved' OR Status = 'Active' OR Status = 'Won' OR Status = 'Awarded' OR Status = 'Completed')`;
        }
        if (lowerQuestion.includes('pharma')) {
            return `SELECT COUNT(*) AS TotalPharmaTenders FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Type = 'Pharma'`;
        }
        return `SELECT COUNT(*) AS TotalTenders FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL)`;
    }
    
    if (lowerQuestion.includes('user') || lowerQuestion.includes('access') || lowerQuestion.includes('portal')) {
        if (lowerQuestion.includes('access') || lowerQuestion.includes('portal') || lowerQuestion.includes('who')) {
            // User asking about who has access to the system
            return `SELECT UserID AS UserID, Name AS UserName, Email AS UserEmail, LastLogin AS LastLogin FROM tenderEmployee WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY Name`;
        }
        return `SELECT TOP 20 UserID AS UserID, Name AS UserName, Email AS UserEmail, LastLogin AS LastLogin FROM tenderEmployee WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY LastLogin DESC`;
    }
    
    if (lowerQuestion.includes('contact')) {
        return `SELECT TOP 20 ContactID AS ContactID, FirstName + ' ' + Surname AS ContactName, Email AS ContactEmail, Phone AS ContactPhone, Status AS ContactStatus FROM tenderContact WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY CreatedAt DESC`;
    }
    
    if (lowerQuestion.includes('company')) {
        return `SELECT TOP 20 CompanyID AS CompanyID, Name AS CompanyName, Phone AS CompanyPhone, Email AS CompanyEmail FROM tenderCompany ORDER BY CreatedAt DESC`;
    }
    
    // Default fallback - show recent tenders
    // Default fallback - show all tenders with their statuses so user can see what's available
    // If user asked about "approved" but got no results, show what status values actually exist
    if (lowerQuestion.includes('approved')) {
        return `SELECT DISTINCT Status AS TenderStatus, COUNT(*) AS Count FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) GROUP BY Status ORDER BY Count DESC`;
    }
    return `SELECT TOP 10 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY CreatedAt DESC`;
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
async function buildPromptWithIntrospection(question, pool, useIntrospection = false, conversationHistory = []) {
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
    
    // Build conversation context if available
    let conversationContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
        conversationContext = '\n\nCONVERSATION HISTORY (for context):\n';
        conversationHistory.slice(-5).forEach((msg, index) => { // Keep last 5 messages for context
            conversationContext += `${index + 1}. User: ${msg.question}\n`;
            if (msg.result && msg.result.length > 0) {
                conversationContext += `   Result: Found ${msg.result.length} records\n`;
            }
        });
        conversationContext += '\nUse this context to understand follow-up questions and references to previous results.\n';
    }
    
    return `You are an expert SQL Server database analyst specializing in tender management systems. Your task is to understand natural language questions and convert them into precise, efficient SQL queries that return TABLE-FRIENDLY column sets.

CONTEXT: This is a tender management system where companies bid on construction and development projects. The user expects most answers as tables. Prefer returning explicit columns with clear aliases over SELECT *.

USER QUESTION: "${escapedQuestion}"${conversationContext}

DATABASE SCHEMA (key tables):

Core Tables:
- tenderTender(TenderID, KeyContact, AddBy, ProjectName, OpenDate, ApplyTo, Value, ReturnDate, Status, Type, Source, ManagingTender, Consultant, Notes, CreatedAt, UpdatedAt, IsDeleted, DeletedAt)
- tenderContact(ContactID, CompanyID, AddBy, FirstName, Surname, Phone, Email, Status, CreatedAt, UpdatedAt, IsDeleted, DeletedAt)
- tenderCompany(CompanyID, AddBy, Name, Phone, Email, CreatedAt, UpdatedAt)
- tenderEmployee(UserID, LastLogin, Name, Email)

Additional Tables (explore freely):
- tenderFolder(FolderID, ParentFolderID, FolderName, FolderPath, FolderType, DisplayOrder, IsActive, AddBy, CreatedAt, UpdatedAt, DocID, ConnectionTable)
- tenderFile(FileID, FolderID, FileName, FilePath, FileSize, ContentType, UploadedBy, UploadedAt, IsActive)
- tenderTask(TaskID, Title, Description, Status, Priority, AssignedTo, CreatedBy, CreatedAt, DueDate, CompletedAt)
- tenderNotification(NotificationID, UserID, Title, Message, Type, IsRead, CreatedAt)
- tenderWatchlist(WatchlistID, UserID, TenderID, CreatedAt)
- tenderBOQ(BOQID, TenderID, ItemName, Description, Quantity, Unit, UnitPrice, TotalPrice, CreatedAt)
- tenderRFI(RFIID, TenderID, Question, Answer, AskedBy, AnsweredBy, AskedAt, AnsweredAt)
- tenderFormField(FieldID, FieldName, FieldType, FieldOptions, IsRequired, DisplayOrder)
- tenderOrgChart(ChartID, TenderID, ChartData, CreatedBy, CreatedAt, UpdatedAt)
- tenderOrgChartHistory(HistoryID, ChartID, ChartData, CreatedBy, CreatedAt)

CRITICAL: Use EXACT column names as shown above. For tenderEmployee, use 'Name' column. If you get column errors, try alternative column names or explore the actual table structure first.

Other tables may exist; explore ALL tables freely for comprehensive answers.

Key Relationships:
- tenderTender.KeyContact → tenderContact.ContactID
- tenderContact.CompanyID → tenderCompany.CompanyID
- tenderTender.AddBy → tenderEmployee.UserID (IMPORTANT: AddBy stores UserID)
- tenderContact.AddBy → tenderEmployee.UserID
- tenderCompany.AddBy → tenderEmployee.UserID
- tenderFolder.ParentFolderID → tenderFolder.FolderID (self-referencing)
- tenderFile.FolderID → tenderFolder.FolderID
- tenderTask.AssignedTo → tenderEmployee.UserID
- tenderTask.CreatedBy → tenderEmployee.UserID
- tenderNotification.UserID → tenderEmployee.UserID
- tenderWatchlist.UserID → tenderEmployee.UserID
- tenderWatchlist.TenderID → tenderTender.TenderID
- tenderBOQ.TenderID → tenderTender.TenderID
- tenderRFI.TenderID → tenderTender.TenderID
- tenderOrgChart.TenderID → tenderTender.TenderID

CRITICAL SQL SYNTAX RULES:
- NEVER use semicolons (;) in the middle of queries
- NEVER mix ORDER BY with WHERE clauses incorrectly
- ALWAYS use proper SQL syntax: SELECT ... FROM ... WHERE ... ORDER BY ...
- NEVER generate malformed queries like "ORDER BY Name; WHERE"
- ALWAYS validate your SQL syntax before generating

INTELLIGENT REASONING INSTRUCTIONS:

1. ANALYZE THE QUESTION CONTEXT:
   - Look for comparative terms: "biggest", "largest", "smallest", "highest", "lowest"
   - Identify filtering criteria: "approved", "active", "pending", "rejected", "pharma", "construction"
   - Recognize temporal references: "recent", "latest", "oldest", "this year", "last month"
   - Understand counting requests: "how many", "count", "total", "number of"

2. DATA-DRIVEN REASONING (CRITICAL):
   - NEVER assume exact word matches for status values
   - ALWAYS explore the actual data first when filtering by status
   - For "approved" queries, use this intelligent approach:
     * First: Try common positive status values
     * If no results: Query what status values actually exist
     * Adapt based on actual data found
   - For temporal queries (2024, this year, etc.), be flexible with date columns
   - For type queries, explore what types actually exist

3. SMART COLUMN INFERENCE:
   - When user asks about "biggest approved", reason that you need to:
     * First try: Status IN ('Approved', 'Active', 'Won', 'Awarded', 'Completed', 'Successful', 'Accepted', 'Confirmed', 'Finalized', 'Closed')
     * If no results: Show what status values exist with counts
     * Order by Value DESC
     * Use TOP 1 for single result
   - When user asks "biggest in 2024", be flexible with date columns:
     * Try OpenDate, CreatedAt, UpdatedAt
     * Use YEAR() function or date ranges
     * If no results, show what date ranges exist

4. CONVERSATION CONTEXT REASONING:
   - If previous question was about "biggest tender" and current question is "what about approved ones"
   - Reason that user wants the biggest tender but filtered by approved status
   - Apply the same Value DESC ordering but add Status filter

5. DYNAMIC QUERY CONSTRUCTION:
   - Always include IsDeleted = 0 OR IsDeleted IS NULL filters
   - Use appropriate JOINs when referencing related data
   - Apply TOP clauses for "biggest", "smallest", "recent" queries
   - Use COUNT() for counting requests
   - Use GROUP BY for aggregation requests
   - When filtering by status, try multiple possible values or explore existing values first

6. COLUMN ALIASING FOR CLARITY:
   - Use descriptive aliases: ProjectName AS ProjectName, Value AS TenderValue
   - Include relevant context columns: Status AS TenderStatus, Type AS TenderType
   - Add temporal context: CreatedAt AS CreatedDate, OpenDate AS OpenDate

7. INTELLIGENT STATUS FILTERING (BE VERY FLEXIBLE):
   - Don't assume exact word matches for status values
   - For "approved" queries, try multiple approaches:
     * First try: Status IN ('Approved', 'Active', 'Won', 'Awarded', 'Completed', 'Successful', 'Accepted', 'Confirmed', 'Finalized', 'Closed', 'Done', 'Finished')
     * If no results, explore what status values actually exist
     * Use LIKE patterns for partial matches if needed
   - For "active" queries, consider: Status = 'Active' OR Status LIKE '%Active%' OR IsDeleted = 0
   - Always show the actual status values in results so user can see what exists

8. TEMPORAL QUERY FLEXIBILITY:
   - For "2024" queries, try multiple date columns: OpenDate, CreatedAt, UpdatedAt
   - Use flexible date matching: YEAR(OpenDate) = 2024 OR YEAR(CreatedAt) = 2024
   - If no results, show what date ranges exist in the data
   - Be flexible with date formats and null handling

9. COLUMN NAME INTELLIGENCE:
   - ALWAYS use exact column names as specified in the schema
   - If you get "Invalid column name" errors, try alternative column names
   - For tenderEmployee table, try: Name, UserName, EmployeeName, FullName
   - If JOINs fail, explore the actual table structure first
   - Use SELECT TOP 1 * FROM tableName to explore actual column names when needed

EXAMPLES OF INTELLIGENT REASONING:

Question: "What's the biggest tender?"
Reasoning: User wants the tender with highest Value. Need TOP 1, ORDER BY Value DESC, include IsDeleted filter.
Query: SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY Value DESC

Question: "What about the biggest approved one?"
Reasoning: User is following up on "biggest tender" but wants only approved ones. Be VERY flexible with status values - try many possible positive statuses.
Query: SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Status IN ('Approved', 'Active', 'Won', 'Awarded', 'Completed', 'Successful', 'Accepted', 'Confirmed', 'Finalized', 'Closed', 'Done', 'Finished') ORDER BY Value DESC

Question: "What's the biggest approved tender in 2024?"
Reasoning: User wants biggest approved tender from 2024. Be flexible with both status AND date columns. Try multiple date columns if needed.
Query: SELECT TOP 1 ProjectName AS ProjectName, Value AS TenderValue, Status AS TenderStatus, Type AS TenderType, OpenDate AS OpenDate FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Status IN ('Approved', 'Active', 'Won', 'Awarded', 'Completed', 'Successful', 'Accepted', 'Confirmed', 'Finalized', 'Closed', 'Done', 'Finished') AND (YEAR(OpenDate) = 2024 OR YEAR(CreatedAt) = 2024) ORDER BY Value DESC

Question: "What status values exist for tenders?"
Reasoning: User wants to explore what status values actually exist in the database. Use DISTINCT to show unique status values.
Query: SELECT DISTINCT Status AS TenderStatus, COUNT(*) AS Count FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) GROUP BY Status ORDER BY Count DESC

Question: "What date ranges exist in the data?"
Reasoning: User wants to explore what date ranges exist. Show min/max dates for different date columns.
Query: SELECT 'OpenDate' AS DateColumn, MIN(OpenDate) AS MinDate, MAX(OpenDate) AS MaxDate FROM tenderTender WHERE OpenDate IS NOT NULL UNION ALL SELECT 'CreatedAt' AS DateColumn, MIN(CreatedAt) AS MinDate, MAX(CreatedAt) AS MaxDate FROM tenderTender WHERE CreatedAt IS NOT NULL

Question: "Who has access to this tender portal?"
Reasoning: User wants to know who can access the system. This means finding all users/employees who have accounts. Look at tenderEmployee table for all active users.
Query: SELECT UserID AS UserID, Name AS UserName, Email AS UserEmail, LastLogin AS LastLogin FROM tenderEmployee WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY Name

Question: "How many users are in the system?"
Reasoning: User wants a count of total users. Count all active employees.
Query: SELECT COUNT(*) AS TotalUsers FROM tenderEmployee WHERE (IsDeleted = 0 OR IsDeleted IS NULL)

Question: "What if no approved tenders found in 2024?"
Reasoning: If the main query returns no results, show what data actually exists to help user understand the data structure.
Query: SELECT 'Status Values' AS DataType, Status AS Value, COUNT(*) AS Count FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) GROUP BY Status UNION ALL SELECT 'Date Ranges' AS DataType, CONCAT(YEAR(OpenDate), '-', YEAR(CreatedAt)) AS Value, COUNT(*) AS Count FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND OpenDate IS NOT NULL GROUP BY YEAR(OpenDate), YEAR(CreatedAt)

Question: "Show me all tasks assigned to users"
Reasoning: User wants to explore task assignments. JOIN tenderTask with tenderEmployee to show comprehensive task data.
Query: SELECT t.TaskID AS TaskID, t.Title AS TaskTitle, t.Status AS TaskStatus, t.Priority AS TaskPriority, e.Name AS AssignedTo, t.CreatedAt AS CreatedDate, t.DueDate AS DueDate FROM tenderTask t LEFT JOIN tenderEmployee e ON t.AssignedTo = e.UserID ORDER BY t.CreatedAt DESC

Question: "What files are in the system?"
Reasoning: User wants to explore file data. JOIN tenderFile with tenderFolder to show comprehensive file information.
Query: SELECT f.FileID AS FileID, f.FileName AS FileName, f.FileSize AS FileSize, f.ContentType AS ContentType, fo.FolderPath AS FolderPath, f.UploadedAt AS UploadedDate FROM tenderFile f LEFT JOIN tenderFolder fo ON f.FolderID = fo.FolderID WHERE f.IsActive = 1 ORDER BY f.UploadedAt DESC

Question: "Show me all notifications for users"
Reasoning: User wants to explore notification data. JOIN tenderNotification with tenderEmployee to show comprehensive notification information.
Query: SELECT n.NotificationID AS NotificationID, n.Title AS NotificationTitle, n.Message AS NotificationMessage, n.Type AS NotificationType, e.Name AS UserName, n.IsRead AS IsRead, n.CreatedAt AS CreatedDate FROM tenderNotification n LEFT JOIN tenderEmployee e ON n.UserID = e.UserID ORDER BY n.CreatedAt DESC

Question: "What if column name 'Name' doesn't exist in tenderEmployee?"
Reasoning: If you get "Invalid column name 'Name'" error, explore the actual table structure first to find the correct column name.
Query: SELECT TOP 1 * FROM tenderEmployee

Question: "Show me 10 biggest tenders with user info"
Reasoning: User wants biggest tenders with user information. If Name column fails, try alternative column names or explore table structure.
Query: SELECT TOP 10 t.TenderID AS TenderID, t.ProjectName AS ProjectName, t.Value AS TenderValue, t.Status AS TenderStatus, t.Type AS TenderType, e.Name AS AddedBy FROM tenderTender t LEFT JOIN tenderEmployee e ON t.AddBy = e.UserID WHERE (t.IsDeleted = 0 OR t.IsDeleted IS NULL) ORDER BY t.Value DESC

Question: "How many pharma tenders are there?"
Reasoning: User wants count of tenders filtered by Type = 'Pharma'. Need COUNT() with WHERE clause.
Query: SELECT COUNT(*) AS TotalPharmaTenders FROM tenderTender WHERE (IsDeleted = 0 OR IsDeleted IS NULL) AND Type = 'Pharma'

Question: "Show me recent contacts"
Reasoning: User wants contacts ordered by most recent. Need ORDER BY CreatedAt DESC with TOP for recent ones.
Query: SELECT TOP 20 FirstName, Surname, Email, Phone, Status, CreatedAt AS CreatedDate FROM tenderContact WHERE (IsDeleted = 0 OR IsDeleted IS NULL) ORDER BY CreatedAt DESC

CRITICAL REQUIREMENTS:
- ALWAYS reason about the question before writing SQL
- NEVER hardcode specific values unless explicitly mentioned by user
- ALWAYS include IsDeleted = 0 OR IsDeleted IS NULL filters
- USE descriptive column aliases for better table presentation
- APPLY appropriate TOP clauses for single-result queries
- INCLUDE relevant context columns (Status, Type, dates) when available
- REASON about conversation context for follow-up questions
- WHEN NO RESULTS FOUND: Show what data actually exists (status values, date ranges, etc.)
- BE ULTRA-FLEXIBLE with status values and date columns
- EXPLORE ACTUAL DATA STRUCTURE when queries return empty results
- EXPLORE ALL TABLES FREELY - you can query any table in the database
- NEVER use INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, EXEC, EXECUTE, TRUNCATE, BACKUP, RESTORE, GRANT, REVOKE, DENY, MERGE, BULK INSERT, OPENROWSET, OPENQUERY
- ONLY use SELECT and WITH statements for data exploration
- JOIN tables freely to provide comprehensive answers
- Use UNION ALL to combine results from multiple tables when relevant

Remember: Focus on the most relevant information for the user's question and use clear, descriptive column aliases. DO NOT include any explanatory text or comments in your response.`;
}

/**
 * POST /api/ai/ask
 * Request body: { question: string, useIntrospection?: boolean, useNewModule?: boolean }
 */
const askTenderAIController = async (req, res) => {
    const startTime = Date.now();
    const { question, useIntrospection = false, useNewModule = false, conversationHistory = [] } = req.body;

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
        const prompt = await buildPromptWithIntrospection(escapedQuestion, pool, useIntrospection, conversationHistory);

        console.log('🤖 Original question:', question);
        console.log('🤖 Question being sent to AI:', escapedQuestion);
        console.log('📝 Prompt length:', prompt.length, 'characters');

        let generated_query;
        try {
            const aiResponse = await openAIService.query(prompt);
            generated_query = aiResponse.generated_query;
        } catch (openAIError) {
            console.log('❌ OpenAI API failed:', openAIError.message);
            
            // If OpenAI fails, use intelligent fallback based on question
            console.log('🔄 OpenAI API failed, using intelligent fallback...');
            const fallbackQuery = getFallbackQuery(question);
            console.log('🔄 Using intelligent fallback query:', fallbackQuery);
            
            try {
                const result = await pool.request().query(fallbackQuery);
                
                const logData = {
                    originalQuestion: question,
                    generatedSQL: 'OPENAI_API_FAILED',
                    cleanedSQL: fallbackQuery,
                    resultCount: result.recordset.length,
                    fallbackUsed: true,
                    success: true,
                    error: null,
                    executionTime: Date.now() - startTime
                };
                logQueryExecution(logData);

                return res.json({
                    question,
                    query: fallbackQuery,
                    result: result.recordset,
                    fallbackUsed: true,
                    openAIFailed: true
                });
            } catch (fallbackError) {
                const logData = {
                    originalQuestion: question,
                    generatedSQL: 'OPENAI_API_FAILED',
                    cleanedSQL: fallbackQuery,
                    resultCount: 0,
                    fallbackUsed: true,
                    success: false,
                    error: fallbackError.message,
                    executionTime: Date.now() - startTime
                };
                logQueryExecution(logData);
                
                return res.status(500).json({
                    error: 'AI service temporarily unavailable. Please try again later.',
                    details: 'OpenAI API capacity exceeded'
                });
            }
        }

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

        // Step 3.5: Validate SQL syntax before execution
        if (!isValidSQLSyntax(finalQuery)) {
            console.log('❌ Invalid SQL syntax detected, using fallback query...');
            console.log('❌ Malformed query:', finalQuery);
            
            const fallbackQuery = getFallbackQuery(question);
            console.log('🔄 Using fallback query:', fallbackQuery);
            
            try {
                result = await pool.request().query(fallbackQuery);
                fallbackUsed = true;
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
        } else {
            // Step 4: Execute the validated query
        console.log('🔍 Executing query:', finalQuery);
        
        try {
            result = await pool.request().query(finalQuery);
        } catch (queryError) {
            console.log('❌ Query failed, trying fallback query...');
                console.log('❌ Query error:', queryError.message);
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
