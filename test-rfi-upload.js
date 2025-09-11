const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:3001';
const TENDER_ID = 1336;
const AUTH_TOKEN = 'your_jwt_token_here'; // Replace with actual token

const headers = {
  'Authorization': `Bearer ${AUTH_TOKEN}`,
};

async function testRFIUpload() {
  console.log('🧪 Testing RFI Upload Functionality\n');
  
  try {
    // Test 1: Upload a test file
    console.log('1️⃣ Testing RFI File Upload...');
    
    // Create a simple test file
    const testContent = `
RFI Document Test

Question 1: What are the specifications for the concrete mix?
Answer: The concrete mix should be C25/30 grade with a minimum cement content of 300kg/m³.

Question 2: What is the required curing period?
Answer: The curing period should be minimum 7 days with proper moisture maintenance.

Question 3: Are there any environmental requirements?
Answer: Yes, all materials must comply with environmental standards and be sourced locally where possible.
    `;
    
    const testFilePath = path.join(__dirname, 'test-rfi.txt');
    fs.writeFileSync(testFilePath, testContent);
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testFilePath));
    formData.append('addBy', 'Test User');
    
    const uploadResponse = await axios.post(
      `${BASE_URL}/api/rfi/${TENDER_ID}/upload`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          ...headers
        }
      }
    );
    
    console.log('✅ Upload successful:', uploadResponse.data);
    const rfiId = uploadResponse.data.rfiId;
    
    // Test 2: Create text-only RFI
    console.log('\n2️⃣ Testing Text-Only RFI Creation...');
    const textRFIData = {
      content: `<div class="rfi-content">
        <h3>RFI Questions & Information</h3>
        <div class="qa-section">
          <h4>Question 1:</h4>
          <p>What are the specifications for the concrete mix?</p>
          <h4>Answer:</h4>
          <p>The concrete mix should be C25/30 grade with a minimum cement content of 300kg/m³.</p>
        </div>
        <div class="qa-section">
          <h4>Question 2:</h4>
          <p>What is the required curing period?</p>
          <h4>Answer:</h4>
          <p>The curing period should be minimum 7 days with proper moisture maintenance.</p>
        </div>
      </div>`,
      addBy: 'Test User',
      type: 'Manual Input'
    };
    
    const textResponse = await axios.post(
      `${BASE_URL}/api/rfi/${TENDER_ID}/text`,
      textRFIData,
      { headers }
    );
    
    console.log('✅ Text-only RFI creation successful:', textResponse.data);
    const textRfiId = textResponse.data.rfiId;
    
    // Test 3: Get all RFIs
    console.log('\n3️⃣ Testing Get All RFIs...');
    const getAllResponse = await axios.get(
      `${BASE_URL}/api/rfi/${TENDER_ID}`,
      { headers }
    );
    console.log('✅ Get all RFIs successful:', getAllResponse.data);
    
    // Test 4: Get specific RFI
    console.log('\n4️⃣ Testing Get Specific RFI...');
    const getSpecificResponse = await axios.get(
      `${BASE_URL}/api/rfi/${TENDER_ID}/${rfiId}`,
      { headers }
    );
    console.log('✅ Get specific RFI successful:');
    console.log('   RFI ID:', getSpecificResponse.data.rfi.RfiId);
    console.log('   Type:', getSpecificResponse.data.rfi.Type);
    console.log('   File Name:', getSpecificResponse.data.rfi.FileName);
    console.log('   Content Preview:', getSpecificResponse.data.rfi.Content.substring(0, 200) + '...');
    
    // Test 5: Download file
    console.log('\n5️⃣ Testing Download RFI File...');
    try {
      const downloadResponse = await axios.get(
        `${BASE_URL}/api/rfi/${TENDER_ID}/${rfiId}/download`,
        { 
          headers,
          responseType: 'stream'
        }
      );
      console.log('✅ Download successful - File stream received');
    } catch (downloadError) {
      console.log('❌ Download failed:', downloadError.response?.data || downloadError.message);
    }
    
    // Test 6: Delete RFIs
    console.log('\n6️⃣ Testing Delete RFIs...');
    const deleteResponse = await axios.delete(
      `${BASE_URL}/api/rfi/${TENDER_ID}/${rfiId}`,
      { headers }
    );
    console.log('✅ Delete file RFI successful:', deleteResponse.data);
    
    const deleteTextResponse = await axios.delete(
      `${BASE_URL}/api/rfi/${TENDER_ID}/${textRfiId}`,
      { headers }
    );
    console.log('✅ Delete text RFI successful:', deleteTextResponse.data);
    
    // Cleanup
    fs.unlinkSync(testFilePath);
    console.log('\n🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    
    // Cleanup on error
    const testFilePath = path.join(__dirname, 'test-rfi.txt');
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  }
}

// Run the test
testRFIUpload();
