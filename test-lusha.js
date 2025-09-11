const axios = require('axios');

// Test Lusha API directly
async function testLushaAPI() {
  console.log('🧪 Testing Lusha API Integration...\n');
  
  const testEmails = [
    'john.doe@microsoft.com',
    'sarah.smith@google.com',
    'mike.johnson@apple.com',
    'test@example.com' // This will likely fail but good for testing
  ];
  
  for (const email of testEmails) {
    console.log(`📧 Testing email: ${email}`);
    
    try {
      const response = await axios.get(`http://localhost:3001/api/contact/lusha?email=${encodeURIComponent(email)}`, {
        headers: {
          'Authorization': 'Bearer YOUR_BACKEND_TOKEN_HERE' // Replace with actual token
        }
      });
      
      console.log('✅ Success!');
      console.log('📊 Response:', JSON.stringify(response.data, null, 2));
      console.log('💰 Credit charged: 1 (always)');
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ Error ${error.response.status}: ${error.response.data.message || 'Unknown error'}`);
        
        if (error.response.status === 429) {
          console.log('⚠️  Rate limit exceeded - check your Lusha dashboard');
        } else if (error.response.status === 401) {
          console.log('🔑 Authentication failed - check your API key');
        }
      } else {
        console.log('❌ Network error:', error.message);
      }
    }
    
    console.log('─'.repeat(50));
  }
}

// Test with a specific contact ID (if you have one)
async function testLushaByContactId(contactId) {
  console.log(`\n🎯 Testing Lusha by Contact ID: ${contactId}`);
  
  try {
    const response = await axios.get(`http://localhost:3001/api/contact/${contactId}/lusha`, {
      headers: {
        'Authorization': 'Bearer YOUR_BACKEND_TOKEN_HERE' // Replace with actual token
      }
    });
    
    console.log('✅ Success!');
    console.log('📊 Response:', JSON.stringify(response.data, null, 2));
    console.log('💰 Credit charged: 1 (always)');
    
  } catch (error) {
    if (error.response) {
      console.log(`❌ Error ${error.response.status}: ${error.response.data.message || 'Unknown error'}`);
    } else {
      console.log('❌ Network error:', error.message);
    }
  }
}

// Run tests
async function runTests() {
  try {
    await testLushaAPI();
    
    // Uncomment and replace with actual contact ID if you want to test by contact ID
    // await testLushaByContactId(123);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Instructions
console.log(`
🚀 LUSHA API TEST SCRIPT
========================

BEFORE RUNNING:
1. Make sure your backend is running on port 3001
2. Set your LUSHA_API_KEY in backend/.env file
3. Get a valid backend token from your frontend
4. Replace 'YOUR_BACKEND_TOKEN_HERE' with actual token

CREDIT USAGE:
⚠️  Each API call costs 1 credit, regardless of result
⚠️  Test with real emails to avoid wasting credits on invalid data

RUN WITH:
node test-lusha.js
`);

// Uncomment to run tests automatically
// runTests();

module.exports = { testLushaAPI, testLushaByContactId };







