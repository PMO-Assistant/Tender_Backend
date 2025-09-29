/**
 * Example usage of the Database Introspection Module
 * 
 * This file demonstrates how to use the database introspection module
 * to get schema information and build prompts for AI models.
 */

const { getConnectedPool } = require('../config/database');
const { 
    getDatabaseContext, 
    buildPrompt, 
    getContextAndBuildPrompt 
} = require('./databaseIntrospection');

/**
 * Example 1: Get complete database context
 */
async function exampleGetDatabaseContext() {
    try {
        const pool = await getConnectedPool();
        
        console.log('🔍 Getting database context...');
        const dbContext = await getDatabaseContext(pool);
        
        console.log('📊 Database Context Summary:');
        console.log(`- Total tables: ${dbContext.totalTables}`);
        console.log(`- Introspection time: ${dbContext.introspectionTime}`);
        
        dbContext.tables.forEach(table => {
            console.log(`\n📋 Table: ${table.tableName}`);
            console.log(`   Columns: ${table.columnCount}`);
            console.log(`   Sample rows: ${table.sampleDataCount}`);
            
            if (table.columns.length > 0) {
                console.log(`   Column types: ${table.columns.map(c => `${c.name}(${c.type})`).join(', ')}`);
            }
        });
        
        return dbContext;
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

/**
 * Example 2: Build a prompt for a specific question
 */
async function exampleBuildPrompt() {
    try {
        const pool = await getConnectedPool();
        const userQuestion = "How many users are there and what are their names?";
        
        console.log('🔍 Building prompt for question:', userQuestion);
        
        const { dbContext, prompt, success } = await getContextAndBuildPrompt(pool, userQuestion);
        
        if (success) {
            console.log('✅ Prompt built successfully');
            console.log('\n📝 Generated Prompt:');
            console.log('='.repeat(50));
            console.log(prompt);
            console.log('='.repeat(50));
            
            return { dbContext, prompt };
        } else {
            console.error('❌ Failed to build prompt');
            return null;
        }
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

/**
 * Example 3: Use introspection with existing AI controller
 */
async function exampleWithAIController() {
    try {
        const pool = await getConnectedPool();
        const userQuestion = "Show me the biggest tender";
        
        // Get database context
        const dbContext = await getDatabaseContext(pool);
        
        // Build prompt using introspection data
        const prompt = buildPrompt(userQuestion, dbContext);
        
        console.log('🤖 Using introspection-based prompt with AI...');
        console.log('📝 Prompt length:', prompt.length, 'characters');
        
        // Here you would pass this prompt to your AI service
        // const aiResponse = await openAIService.query(prompt);
        
        return { dbContext, prompt };
        
    } catch (error) {
        console.error('❌ Error in example:', error);
        throw error;
    }
}

/**
 * Example 4: Cache database context for performance
 */
let cachedDbContext = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getCachedDatabaseContext(pool) {
    const now = Date.now();
    
    // Return cached context if it's still valid
    if (cachedDbContext && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
        console.log('📋 Using cached database context');
        return cachedDbContext;
    }
    
    // Get fresh context
    console.log('🔄 Refreshing database context cache...');
    cachedDbContext = await getDatabaseContext(pool);
    cacheTimestamp = now;
    
    return cachedDbContext;
}

/**
 * Example 5: Performance monitoring
 */
async function exampleWithPerformanceMonitoring() {
    const startTime = Date.now();
    
    try {
        const pool = await getConnectedPool();
        
        console.log('⏱️ Starting performance test...');
        
        // Test 1: Full introspection
        const introspectionStart = Date.now();
        const dbContext = await getDatabaseContext(pool);
        const introspectionTime = Date.now() - introspectionStart;
        
        // Test 2: Prompt building
        const promptStart = Date.now();
        const prompt = buildPrompt("How many tenders are there?", dbContext);
        const promptTime = Date.now() - promptStart;
        
        // Test 3: Cached context
        const cacheStart = Date.now();
        const cachedContext = await getCachedDatabaseContext(pool);
        const cacheTime = Date.now() - cacheStart;
        
        console.log('📊 Performance Results:');
        console.log(`- Full introspection: ${introspectionTime}ms`);
        console.log(`- Prompt building: ${promptTime}ms`);
        console.log(`- Cached context: ${cacheTime}ms`);
        console.log(`- Total time: ${Date.now() - startTime}ms`);
        
        return {
            dbContext,
            prompt,
            performance: {
                introspectionTime,
                promptTime,
                cacheTime,
                totalTime: Date.now() - startTime
            }
        };
        
    } catch (error) {
        console.error('❌ Error in performance test:', error);
        throw error;
    }
}

// Export examples for use in other files
module.exports = {
    exampleGetDatabaseContext,
    exampleBuildPrompt,
    exampleWithAIController,
    getCachedDatabaseContext,
    exampleWithPerformanceMonitoring
};

// Run examples if this file is executed directly
if (require.main === module) {
    (async () => {
        try {
            console.log('🚀 Running database introspection examples...\n');
            
            // Example 1: Get database context
            console.log('📋 Example 1: Getting database context');
            await exampleGetDatabaseContext();
            console.log('\n' + '='.repeat(50) + '\n');
            
            // Example 2: Build prompt
            console.log('📝 Example 2: Building prompt');
            await exampleBuildPrompt();
            console.log('\n' + '='.repeat(50) + '\n');
            
            // Example 3: Performance monitoring
            console.log('⏱️ Example 3: Performance monitoring');
            await exampleWithPerformanceMonitoring();
            
            console.log('\n✅ All examples completed successfully!');
            
        } catch (error) {
            console.error('❌ Error running examples:', error);
        }
    })();
} 