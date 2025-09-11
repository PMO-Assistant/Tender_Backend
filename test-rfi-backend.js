// Test script for RFI backend functionality
const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';
const TEST_TENDER_ID = 1; // Replace with actual tender ID
const TEST_TOKEN = 'your-test-token'; // Replace with actual token

async function testRFIBackend() {
  console.log('🧪 Testing RFI Backend Functionality\n');

  const headers = {
    'Authorization': `Bearer ${TEST_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    // Test 1: Create text-only RFI
    console.log('1️⃣ Testing text-only RFI creation...');
    const textRFI = {
      type: 'General Question',
      content: 'What is the expected completion date for this project?',
      addBy: 'Test User'
    };

    const createTextResponse = await axios.post(
      `${BASE_URL}/rfi/${TEST_TENDER_ID}`,
      textRFI,
      { headers }
    );

    console.log('✅ Text RFI created:', createTextResponse.data);
    const textRFIId = createTextResponse.data.rfiId;

    // Test 2: Create RFI with file
    console.log('\n2️⃣ Testing RFI with file creation...');
    const fileRFI = {
      type: 'Technical Specification',
      content: 'Please review the attached technical drawings for compliance.',
      addBy: 'Test User',
      fileId: 1 // Replace with actual file ID
    };

    const createFileResponse = await axios.post(
      `${BASE_URL}/rfi/${TEST_TENDER_ID}/file`,
      fileRFI,
      { headers }
    );

    console.log('✅ File RFI created:', createFileResponse.data);
    const fileRFIId = createFileResponse.data.rfiId;

    // Test 3: Get all RFIs for tender
    console.log('\n3️⃣ Testing get all RFIs...');
    const getAllResponse = await axios.get(
      `${BASE_URL}/rfi/${TEST_TENDER_ID}`,
      { headers }
    );

    console.log('✅ All RFIs retrieved:', getAllResponse.data.rfis.length, 'RFIs found');

    // Test 4: Get specific RFI
    console.log('\n4️⃣ Testing get specific RFI...');
    const getSpecificResponse = await axios.get(
      `${BASE_URL}/rfi/${TEST_TENDER_ID}/${textRFIId}`,
      { headers }
    );

    console.log('✅ Specific RFI retrieved:', getSpecificResponse.data.rfi);

    // Test 5: Update RFI
    console.log('\n5️⃣ Testing RFI update...');
    const updateData = {
      content: 'Updated: What is the expected completion date for this project? Please provide detailed timeline.',
      type: 'Urgent Question'
    };

    const updateResponse = await axios.put(
      `${BASE_URL}/rfi/${TEST_TENDER_ID}/${textRFIId}`,
      updateData,
      { headers }
    );

    console.log('✅ RFI updated:', updateResponse.data.message);

    // Test 6: Get RFI types
    console.log('\n6️⃣ Testing get RFI types...');
    const getTypesResponse = await axios.get(
      `${BASE_URL}/rfi/types`,
      { headers }
    );

    console.log('✅ RFI types retrieved:', getTypesResponse.data.types);

    // Test 7: Download RFI file (if file RFI exists)
    if (fileRFIId) {
      console.log('\n7️⃣ Testing RFI file download...');
      try {
        const downloadResponse = await axios.get(
          `${BASE_URL}/rfi/${TEST_TENDER_ID}/${fileRFIId}/download`,
          { 
            headers,
            responseType: 'stream'
          }
        );
        console.log('✅ RFI file download successful');
      } catch (downloadError) {
        console.log('⚠️ RFI file download failed (expected if no file attached):', downloadError.response?.status);
      }
    }

    // Test 8: Delete RFI
    console.log('\n8️⃣ Testing RFI deletion...');
    const deleteResponse = await axios.delete(
      `${BASE_URL}/rfi/${TEST_TENDER_ID}/${textRFIId}`,
      { headers }
    );

    console.log('✅ RFI deleted:', deleteResponse.data.message);

    console.log('\n🎉 All RFI backend tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('\n💡 Tip: Make sure to set a valid TEST_TOKEN');
    }
    if (error.response?.status === 404) {
      console.log('\n💡 Tip: Make sure TEST_TENDER_ID exists in the database');
    }
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  testRFIBackend();
}

module.exports = { testRFIBackend };

