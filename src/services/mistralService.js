const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

class MistralService {
    constructor() {
        this.apiKey = process.env.MISTRAL_API_KEY;
        this.baseUrl = 'https://api.mistral.ai/v1';
    }

    async extractMetadata(fileBuffer, fileName, contentType) {
        try {
            // Extract full text content first using lightweight libraries
            const extractedText = await this.extractTextContent(fileBuffer, fileName, contentType);
            
            if (!this.apiKey) {
                console.warn('MISTRAL_API_KEY not found, skipping metadata extraction');
                const fallback = this.createFallbackMetadata(fileName, contentType);
                fallback.extractedText = extractedText;
                fallback.textLength = extractedText ? extractedText.length : 0;
                return fallback;
            }

            // Create metadata prompt with text content
            let prompt = this.createMetadataPrompt(fileName, contentType);
            
            if (extractedText && extractedText.length > 0) {
                // Limit text content to avoid token limits while keeping it searchable
                const truncatedText = extractedText.substring(0, 6000); // Reduced for more focused extraction
                prompt += `\n\nFile Content:\n${truncatedText}`;
            }

            const response = await axios.post(`${this.baseUrl}/chat/completions`, {
                model: 'mistral-large-latest',
                messages: [
                    {
                        role: 'user',
                        content: `${prompt}\n\nReturn ONLY a single JSON object. Do not include markdown, code fences, or any commentary.`
                    }
                ],
                max_tokens: 1000, // Reduced for more concise responses
                temperature: 0.1
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const extractedMetadata = response.data.choices[0].message.content;
            
            // Parse the response and structure it with text content
            const metadata = this.parseMetadataResponse(extractedMetadata, fileName, contentType);
            metadata.extractedText = extractedText; // Include full text for search
            metadata.textLength = extractedText ? extractedText.length : 0;
            
            return metadata;
            
        } catch (error) {
            console.error('Error extracting metadata with Mistral:', error);
            const fallback = this.createFallbackMetadata(fileName, contentType);
            fallback.extractedText = await this.extractTextContent(fileBuffer, fileName, contentType);
            fallback.textLength = fallback.extractedText ? fallback.extractedText.length : 0;
            return fallback;
        }
    }

    async extractTextContent(fileBuffer, fileName, contentType) {
        try {
            const fileExtension = fileName.split('.').pop()?.toLowerCase();
            
            // Handle different file types with appropriate libraries
            if (contentType.includes('pdf') || fileExtension === 'pdf') {
                return await this.extractTextFromPDF(fileBuffer);
            } else if (contentType.includes('word') || fileExtension === 'docx' || fileExtension === 'doc') {
                return await this.extractTextFromWord(fileBuffer);
            } else if (contentType.includes('excel') || fileExtension === 'xlsx' || fileExtension === 'xls') {
                return await this.extractTextFromExcel(fileBuffer);
            } else if (contentType.includes('text/plain') || fileExtension === 'txt') {
                return fileBuffer.toString('utf-8');
            } else if (contentType.includes('json') || fileExtension === 'json') {
                try {
                    const jsonContent = JSON.parse(fileBuffer.toString('utf-8'));
                    return JSON.stringify(jsonContent, null, 2);
                } catch (e) {
                    return fileBuffer.toString('utf-8');
                }
            } else if (contentType.includes('xml') || fileExtension === 'xml') {
                return fileBuffer.toString('utf-8');
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting text content:', error);
            return null;
        }
    }

    async extractTextFromPDF(fileBuffer) {
        try {
            const data = await pdfParse(fileBuffer);
            return data.text;
        } catch (error) {
            console.error('Error extracting text from PDF:', error);
            return null;
        }
    }

    async extractTextFromWord(fileBuffer) {
        try {
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            return result.value;
        } catch (error) {
            console.error('Error extracting text from Word document:', error);
            return null;
        }
    }

    async extractTextFromExcel(fileBuffer) {
        try {
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            let allText = '';
            
            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                jsonData.forEach(row => {
                    if (Array.isArray(row)) {
                        row.forEach(cell => {
                            if (cell && typeof cell === 'string') {
                                allText += cell + ' ';
                            } else if (cell && typeof cell === 'number') {
                                allText += cell.toString() + ' ';
                            }
                        });
                        allText += '\n';
                    }
                });
            });
            
            return allText.trim();
        } catch (error) {
            console.error('Error extracting text from Excel file:', error);
            return null;
        }
    }

    createMetadataPrompt(fileName, contentType) {
        return `You are a document analyst. Extract ONLY the most essential metadata for search and categorization.

IMPORTANT: Return ONLY valid JSON in the exact format below. No additional text.

{
  "title": "Clear, descriptive title (max 10 words)",
  "summary": "1-2 sentence summary of document purpose",
  "keywords": ["key", "search", "terms", "max", "8", "keywords"],
  "documentType": "Document category (e.g., 'BOQ', 'Contract', 'Drawing', 'Report', 'Quote', 'Specification')",
  "category": "Business category (e.g., 'Construction', 'Engineering', 'Legal', 'Financial')",
  "parties": ["Key companies", "organizations", "people", "max", "5"],
  "dates": ["Important dates", "deadlines", "max", "3"],
  "values": ["Key amounts", "quantities", "max", "5"],
  "project": "Project name or reference if mentioned",
  "status": "Document status if mentioned (e.g., 'Draft', 'Final', 'Approved')"
}

File: ${fileName}
Content Type: ${contentType}

Focus on:
- Essential business information only
- Key stakeholders and amounts
- Important dates and project details
- Industry-specific terms

Be concise and specific. Avoid generic terms.`;
    }

    parseMetadataResponse(response, fileName, contentType) {
        try {
            // Normalize and strip common markdown/fence noise
            let cleaned = String(response || '')
                .replace(/```json/gi, '')
                .replace(/```/g, '')
                .replace(/\r?\n/g, '\n');

            // Extract the first balanced JSON object
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                let jsonStr = jsonMatch[0];
                // Remove stray leading list markers that might sneak in
                jsonStr = jsonStr.replace(/^\s*[\*\-]\s*/gm, '');
                const parsed = JSON.parse(jsonStr);
                
                // Ensure all required fields exist with defaults
                const enhancedMetadata = {
                    title: parsed.title || this.generateTitleFromFileName(fileName),
                    summary: parsed.summary || `Document: ${fileName}`,
                    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
                    documentType: parsed.documentType || this.inferDocumentType(fileName, contentType),
                    category: parsed.category || this.inferCategory(fileName, contentType),
                    parties: Array.isArray(parsed.parties) ? parsed.parties : [],
                    dates: Array.isArray(parsed.dates) ? parsed.dates : [],
                    values: Array.isArray(parsed.values) ? parsed.values : [],
                    project: parsed.project || null,
                    status: parsed.status || null,
                    extractedAt: new Date().toISOString(),
                    extractionMethod: 'mistral-ai',
                    fileName: fileName,
                    contentType: contentType
                };
                
                return enhancedMetadata;
            }
        } catch (e) {
            console.log('Could not parse Mistral response as JSON:', e.message);
        }

        // Fallback: create structured metadata from text response
        return {
            title: this.generateTitleFromFileName(fileName),
            summary: response.substring(0, 200),
            keywords: this.extractKeywords(response),
            documentType: this.inferDocumentType(fileName, contentType),
            category: this.inferCategory(fileName, contentType),
            parties: [],
            dates: [],
            values: [],
            project: null,
            status: null,
            extractedAt: new Date().toISOString(),
            extractionMethod: 'mistral-ai-fallback',
            fileName: fileName,
            contentType: contentType
        };
    }

    extractKeywords(text) {
        if (!text) return [];
        
        // Industry-specific terms and technical jargon
        const industryTerms = [
            'construction', 'engineering', 'architecture', 'tender', 'bid', 'contract',
            'specification', 'drawing', 'plan', 'design', 'project', 'client',
            'contractor', 'subcontractor', 'supplier', 'vendor', 'consultant',
            'rfp', 'rfi', 'boq', 'saq', 'tender', 'proposal', 'quote',
            'cost', 'budget', 'estimate', 'pricing', 'schedule', 'timeline',
            'quality', 'safety', 'compliance', 'standards', 'regulations',
            'materials', 'equipment', 'labor', 'installation', 'maintenance',
            'foundation', 'structure', 'mechanical', 'electrical', 'plumbing',
            'hvac', 'fire', 'security', 'landscaping', 'interior', 'exterior'
        ];
        
        // Common words to exclude
        const commonWords = [
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
            'from', 'into', 'during', 'including', 'until', 'against', 'among',
            'throughout', 'despite', 'towards', 'upon', 'concerning', 'about'
        ];
        
        // Extract words from text
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        const wordCount = {};
        
        words.forEach(word => {
            // Only consider words longer than 3 characters
            if (word.length > 3 && !commonWords.includes(word)) {
                // Give higher weight to industry-specific terms
                const weight = industryTerms.includes(word) ? 3 : 1;
                wordCount[word] = (wordCount[word] || 0) + weight;
            }
        });
        
        // Sort by frequency and weight, then take top keywords
        return Object.entries(wordCount)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 8) // Reduced to 8 keywords for more focused extraction
            .map(([word]) => word);
    }

    inferDocumentType(fileName, contentType) {
        const ext = fileName.split('.').pop()?.toLowerCase();
        
        if (contentType.includes('pdf')) return 'PDF Document';
        if (contentType.includes('word')) return 'Word Document';
        if (contentType.includes('excel') || ext === 'xlsx' || ext === 'xls') return 'Spreadsheet';
        if (contentType.includes('powerpoint') || ext === 'pptx' || ext === 'ppt') return 'Presentation';
        if (contentType.includes('image')) return 'Image';
        if (ext === 'dwg' || ext === 'dxf') return 'CAD Drawing';
        if (ext === 'zip' || ext === 'rar') return 'Archive';
        
        return 'Document';
    }

    generateTitleFromFileName(fileName) {
        // Remove file extension
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
        
        // Replace underscores and dashes with spaces
        let title = nameWithoutExt.replace(/[_-]/g, ' ');
        
        // Capitalize first letter of each word
        title = title.replace(/\b\w/g, l => l.toUpperCase());
        
        // Handle common abbreviations
        title = title.replace(/\bRfi\b/gi, 'RFI');
        title = title.replace(/\bBoq\b/gi, 'BOQ');
        title = title.replace(/\bSaq\b/gi, 'SAQ');
        title = title.replace(/\bTnd\b/gi, 'Tender');
        
        return title;
    }

    inferCategory(fileName, contentType) {
        const fileNameLower = fileName.toLowerCase();
        const ext = fileName.split('.').pop()?.toLowerCase();
        
        // Check for specific tender-related terms
        if (fileNameLower.includes('rfi') || fileNameLower.includes('request for information')) {
            return 'RFI';
        }
        if (fileNameLower.includes('boq') || fileNameLower.includes('bill of quantities')) {
            return 'BOQ';
        }
        if (fileNameLower.includes('saq') || fileNameLower.includes('supplier assessment')) {
            return 'SAQ';
        }
        if (fileNameLower.includes('tender') || fileNameLower.includes('bid')) {
            return 'Tender';
        }
        if (fileNameLower.includes('contract') || fileNameLower.includes('agreement')) {
            return 'Legal';
        }
        if (fileNameLower.includes('specification') || fileNameLower.includes('spec')) {
            return 'Technical';
        }
        if (fileNameLower.includes('drawing') || fileNameLower.includes('plan') || ext === 'dwg' || ext === 'dxf') {
            return 'Engineering';
        }
        if (fileNameLower.includes('quote') || fileNameLower.includes('pricing') || fileNameLower.includes('cost')) {
            return 'Financial';
        }
        if (fileNameLower.includes('report') || fileNameLower.includes('analysis')) {
            return 'Administrative';
        }
        
        // Default based on content type
        if (contentType.includes('image')) return 'Visual';
        if (contentType.includes('pdf')) return 'Document';
        if (contentType.includes('excel')) return 'Data';
        
        return 'General';
    }

    createFallbackMetadata(fileName, contentType) {
        return {
            title: this.generateTitleFromFileName(fileName),
            summary: `File: ${fileName}`,
            keywords: [],
            documentType: this.inferDocumentType(fileName, contentType),
            category: this.inferCategory(fileName, contentType),
            parties: [],
            dates: [],
            values: [],
            project: null,
            status: null,
            extractedAt: new Date().toISOString(),
            extractionMethod: 'fallback',
            fileName: fileName,
            contentType: contentType,
            extractedText: null,
            textLength: 0
        };
    }
}

module.exports = new MistralService();


