import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  validateFile,
  extractDocxText,
  isPdfFile,
  cleanJsonResponse,
  type ResumeExtractionResult,
  type ResumeProcessingResult,
} from './utils';
import { addCandidate } from '@/lib/helix';

export const runtime = 'nodejs';

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Extracts name, email, skills, and summary from resume using Gemini
 * Supports both PDF (sent directly as base64) and DOCX (text extracted first)
 */
async function extractResumeDataWithGemini(
  file: File,
  buffer: Buffer
): Promise<ResumeExtractionResult> {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `Extract the following from this resume and return JSON only in this exact form:
{
  "name": "Full name of the candidate",
  "email": "Email address (or empty string if not found)",
  "skills": ["Array of 6-12 relevant skills or keywords"],
  "summary": "A 2-3 sentence professional overview of the candidate"
}`;

  let result;
  
  try {
    if (isPdfFile(file)) {
      // For PDFs: Convert to base64 and send directly to Gemini
      // Gemini 1.5 supports PDF files natively via inline data
      const base64Data = buffer.toString('base64');
      
      result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType: 'application/pdf',
          },
        },
      ]);
    } else {
      // For DOCX: Extract text first, then send to Gemini
      const resumeText = await extractDocxText(buffer);
      
      if (!resumeText || resumeText.trim().length === 0) {
        throw new Error('Could not extract text from DOCX file. The file may be corrupted or empty.');
      }
      
      result = await model.generateContent(`${prompt}\n\nHere is the resume text:\n\n${resumeText}`);
    }
  } catch (error: any) {
    // Provide more specific error messages
    if (error?.message?.includes('API_KEY')) {
      throw new Error('Invalid or missing Gemini API key. Please check your GEMINI_API_KEY environment variable.');
    }
    if (error?.message?.includes('QUOTA') || error?.message?.includes('quota')) {
      throw new Error('Gemini API quota exceeded. Please check your API usage limits.');
    }
    if (error?.message?.includes('SAFETY') || error?.message?.includes('safety')) {
      throw new Error('Content was blocked by Gemini safety filters. Please try a different resume.');
    }
    if (error?.message?.includes('SIZE') || error?.message?.includes('size') || error?.message?.includes('too large')) {
      throw new Error('File is too large. Maximum file size is 10MB.');
    }
    // Re-throw with original message for other errors
    throw new Error(`Gemini API error: ${error?.message || 'Unknown error occurred while processing the file'}`);
  }

  const response = result.response;
  const responseText = response.text();

  const cleanedResponse = cleanJsonResponse(responseText);

  try {
    const parsed = JSON.parse(cleanedResponse) as ResumeExtractionResult;

    // Validate the response structure
    if (typeof parsed.name !== 'string') {
      throw new Error('Invalid response: name must be a string');
    }
    if (typeof parsed.email !== 'string') {
      throw new Error('Invalid response: email must be a string');
    }
    if (!Array.isArray(parsed.skills)) {
      throw new Error('Invalid response: skills must be an array');
    }
    if (typeof parsed.summary !== 'string') {
      throw new Error('Invalid response: summary must be a string');
    }

    // Ensure skills count is between 6-12
    if (parsed.skills.length < 6) {
      console.warn(
        `Gemini returned fewer than 6 skills (${parsed.skills.length})`
      );
    }
    if (parsed.skills.length > 12) {
      parsed.skills = parsed.skills.slice(0, 12);
    }

    return parsed;
  } catch (error) {
    console.error('Failed to parse Gemini response:', responseText);
    throw new Error(
      `Failed to parse resume extraction response: ${error instanceof Error ? error.message : 'Invalid JSON'}`
    );
  }
}

/**
 * Generates an embedding for the combined summary and skills using Gemini
 */
async function generateEmbedding(
  summary: string,
  skills: string[]
): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  const combinedText = `${summary}\nSkills: ${skills.join(', ')}`;

  const result = await model.embedContent({
    content: {
      role: 'user',
      parts: [{ text: combinedText }],
    },
  });

  if (!result.embedding || !result.embedding.values || !Array.isArray(result.embedding.values)) {
    throw new Error('Failed to generate embedding: Invalid response structure');
  }

  return result.embedding.values;
}

export async function POST(request: NextRequest) {
  try {
    // Check for API key
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error: Gemini API key not configured',
        },
        { status: 500 }
      );
    }

    // Parse multipart form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            'Invalid request format. Please submit as multipart/form-data with a file field named "resume".',
        },
        { status: 400 }
      );
    }

    const file = formData.get('resume') as File | null;

    // Validate the uploaded file
    const validation = validateFile(file!);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    // Read file as buffer
    let buffer: Buffer;
    try {
      const bytes = await file!.arrayBuffer();
      buffer = Buffer.from(bytes);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to read the uploaded file. Please try again.',
        },
        { status: 400 }
      );
    }

    // Extract name, email, skills, and summary using Gemini
    // For PDFs: Gemini processes the file directly (no parsing needed!)
    // For DOCX: Text is extracted first, then sent to Gemini
    let extractionResult: ResumeExtractionResult;
    let rawText: string = '';
    
    try {
      extractionResult = await extractResumeDataWithGemini(file!, buffer);
      
      // Extract raw text for response (only needed for DOCX, PDF is processed directly)
      if (!isPdfFile(file!)) {
        rawText = await extractDocxText(buffer);
      } else {
        // For PDFs, Gemini processed it directly - no text extraction needed
        rawText = 'PDF processed directly by Gemini (no text extraction required)';
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      console.error('Gemini skills extraction error:', {
        message: errorMessage,
        stack: errorStack,
        fileType: file!.type,
        fileName: file!.name,
        fileSize: file!.size,
      });
      
      // Return more helpful error messages based on the error type
      let userMessage = 'Failed to analyze resume content.';
      let statusCode = 500;
      
      if (errorMessage.includes('API key')) {
        userMessage = 'Server configuration error: Invalid or missing Gemini API key.';
        statusCode = 500;
      } else if (errorMessage.includes('quota')) {
        userMessage = 'API quota exceeded. Please try again later.';
        statusCode = 429;
      } else if (errorMessage.includes('safety')) {
        userMessage = 'Content was blocked by safety filters. Please try a different resume.';
        statusCode = 400;
      } else if (errorMessage.includes('too large')) {
        userMessage = 'File is too large. Maximum file size is 10MB.';
        statusCode = 400;
      } else if (errorMessage.includes('extract text')) {
        userMessage = 'Could not read the file. Please ensure it is a valid PDF or DOCX file.';
        statusCode = 400;
      } else {
        userMessage = `Failed to analyze resume: ${errorMessage}`;
      }
      
      return NextResponse.json(
        {
          success: false,
          error: userMessage,
          details: errorMessage,
        },
        { status: statusCode }
      );
    }

    // Generate embedding for the combined summary and skills
    let embedding: number[];
    try {
      embedding = await generateEmbedding(
        extractionResult.summary,
        extractionResult.skills
      );
    } catch (error) {
      console.error('Embedding generation error:', error);
      return NextResponse.json(
        {
          success: false,
          error:
            'Failed to generate embedding. Please try again or contact support.',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // Save candidate to HelixDB
    let savedToDatabase = false;
    let databaseError: string | undefined;
    try {
      const dbResult = await addCandidate({
        name: extractionResult.name,
        email: extractionResult.email,
        summary: extractionResult.summary,
        skills: extractionResult.skills.join(', '),
        embedding,
      });
      savedToDatabase = true;
      console.log('Successfully saved candidate to HelixDB:', {
        name: extractionResult.name,
        email: extractionResult.email,
        dbResult,
      });
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Unknown database error';
      console.error('Failed to save candidate to HelixDB:', {
        error: databaseError,
        candidate: {
          name: extractionResult.name,
          email: extractionResult.email,
        },
        fullError: error,
      });
      // Continue even if DB save fails - we still want to return the extracted data
    }

    // Build the successful response
    const result: ResumeProcessingResult = {
      success: true,
      rawText,
      name: extractionResult.name,
      email: extractionResult.email,
      skills: extractionResult.skills,
      summary: extractionResult.summary,
      embedding,
      savedToDatabase,
      ...(databaseError && { databaseError }),
    };

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('Unexpected error processing resume:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred while processing the resume.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
