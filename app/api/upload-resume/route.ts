import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  validateFile,
  extractTextFromFile,
  cleanJsonResponse,
  type SkillsExtractionResult,
  type ResumeProcessingResult,
} from './utils';

export const runtime = 'nodejs';

// Configure body size limit for large file uploads (Next.js 13+)
export const config = {
  api: {
    bodyParser: false,
  },
};

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Extracts skills and summary from resume text using Gemini
 */
async function extractSkillsWithGemini(
  resumeText: string
): Promise<SkillsExtractionResult> {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `Extract exactly 6–12 skills or keywords from the resume text below. Return JSON only in the form: { "skills": string[], "summary": string }. The summary should be a 2-3 sentence professional overview of the candidate. Here is the resume text:

${resumeText}`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const responseText = response.text();

  const cleanedResponse = cleanJsonResponse(responseText);

  try {
    const parsed = JSON.parse(cleanedResponse) as SkillsExtractionResult;

    // Validate the response structure
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
    console.error('Failed to parse Gemini skills response:', responseText);
    throw new Error(
      `Failed to parse skills extraction response: ${error instanceof Error ? error.message : 'Invalid JSON'}`
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

    // Read file as buffer with streaming for large files
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

    // Extract text from the file
    let rawText: string;
    try {
      rawText = await extractTextFromFile(file!, buffer);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to extract text from the file.',
        },
        { status: 400 }
      );
    }

    // Extract skills and summary using Gemini
    let skillsResult: SkillsExtractionResult;
    try {
      skillsResult = await extractSkillsWithGemini(rawText);
    } catch (error) {
      console.error('Gemini skills extraction error:', error);
      return NextResponse.json(
        {
          success: false,
          error:
            'Failed to analyze resume content. Please try again or contact support.',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // Generate embedding for the combined summary and skills
    let embedding: number[];
    try {
      embedding = await generateEmbedding(
        skillsResult.summary,
        skillsResult.skills
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

    // Build the successful response
    const result: ResumeProcessingResult = {
      success: true,
      rawText,
      skills: skillsResult.skills,
      summary: skillsResult.summary,
      embedding,
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
