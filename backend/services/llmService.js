import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * LLM SERVICE FOR HINT GENERATION
 * 
 * CRITICAL REQUIREMENT: Never provide full SQL solutions
 * Always return hints, conceptual guidance, and non-runnable pseudo-code
 * 
 * Provider: OpenAI (configurable via LLM_PROVIDER env var)
 */

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY && LLM_PROVIDER === 'openai') {
  console.warn('Warning: OPENAI_API_KEY not set. Hint functionality will not work.');
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/**
 * System prompt that enforces hint-only responses
 * This is prepended to every LLM request
 */
const SYSTEM_PROMPT = `You are a hint-only assistant for a SQL learning platform. 

Your role is to provide high-level guidance, debugging tips, and conceptual hints to help students learn SQL. 

CRITICAL RULES:
1. NEVER provide full, runnable SQL queries
2. If the user asks for the full solution, politely refuse and offer step-by-step conceptual hints instead
3. Provide guidance using pseudo-code, English descriptions, or partial SQL patterns (not complete queries)
4. Focus on teaching concepts rather than giving answers

Always respond in valid JSON format:
{
  "hint": "<one paragraph high-level hint addressing the student's current approach>",
  "nextSteps": ["<step 1>", "<step 2>", "<step 3>"],
  "explainWhy": "<one sentence explaining the reasoning behind this advice>"
}

Do not include any text outside the JSON structure.`;

/**
 * Generate a hint for a SQL assignment
 * @param {Object} assignmentContext - Assignment metadata (title, schema, etc.)
 * @param {string} userQuery - The student's current SQL attempt (can be empty)
 * @param {string} hintLevel - 'low' | 'medium' | 'high' (how detailed the hint should be)
 * @returns {Promise<Object>} { hint, nextSteps, explainWhy } or error
 */
export const getHint = async (assignmentContext, userQuery, hintLevel = 'low') => {
  if (!openai) {
    return {
      error: 'LLM service is not configured. Please set OPENAI_API_KEY in your environment.',
      hint: null,
      nextSteps: [],
      explainWhy: null
    };
  }

  try {
    // Construct the user prompt with assignment context
    // Create VERY distinct instructions for each hint level
    let levelInstruction;
    if (hintLevel === 'low') {
      levelInstruction = 'Provide ONLY a  very low-level strategic hint. Focus on what SQL concepts or clauses might be needed (e.g., "Think about JOINs" or "Consider using GROUP BY"). Do NOT mention specific table or column names. Keep it extremely brief and conceptual.';
    } else if (hintLevel === 'medium') {
      levelInstruction = 'Provide a medium-detail hint. You can mention which tables are involved and what type of operations are needed, but do NOT provide actual column names or SQL syntax. Guide them on the approach and logic flow.';
    } else {
      levelInstruction = 'Provide a detailed hint with pseudocode and specific guidance. You can mention table names, column names, and provide pseudocode patterns like "SELECT [columns] FROM [table] WHERE [condition]", but do NOT provide the complete runnable SQL query. Be very specific about the steps.';
    }

    const userPrompt = JSON.stringify({
      assignmentTitle: assignmentContext.title,
      assignmentQuestion: assignmentContext.question,
      schema: assignmentContext.sampleSchemas.map(s => ({
        table: s.table,
        columns: s.columns
      })),
      userQuery: userQuery || '(student has not submitted a query yet)',
      hintLevel: hintLevel,
      instruction: levelInstruction
    });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' } // Enforce JSON response
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    // Validate response structure
    if (!parsed.hint || !parsed.nextSteps || !parsed.explainWhy) {
      throw new Error('Invalid LLM response structure');
    }

    return {
      hint: parsed.hint,
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      explainWhy: parsed.explainWhy,
      error: null
    };

  } catch (error) {
    console.error('LLM hint generation error:', error);
    return {
      error: 'Failed to generate hint. Please try again.',
      hint: null,
      nextSteps: [],
      explainWhy: null
    };
  }
};

/**
 * Backup hint generator (if LLM is unavailable)
 * Returns generic helpful hints based on assignment metadata
 */
export const getFallbackHint = (assignmentContext, hintLevel = 'low') => {
  const tables = assignmentContext.sampleSchemas.map(s => s.table).join(', ');
  
  // Provide different hints based on level
  if (hintLevel === 'low') {
    return {
      hint: `This assignment involves the following tables: ${tables}. Try to break down the problem into smaller steps.`,
      nextSteps: [
        'Review the table schemas carefully',
        'Identify which columns you need to SELECT',
        'Consider if you need to JOIN multiple tables',
        'Think about any filtering (WHERE) or grouping (GROUP BY) needed'
      ],
      explainWhy: 'These are general SQL query construction steps',
      error: null
    };
  } else if (hintLevel === 'medium') {
    const tableDetails = assignmentContext.sampleSchemas.map(s => 
      `${s.table} (${s.columns.map(c => c.name).join(', ')})`
    ).join('; ');
    
    return {
      hint: `This assignment uses these tables: ${tableDetails}. Think about which tables need to be connected and what data you're looking for.`,
      nextSteps: [
        'Identify the primary and foreign keys for joining tables',
        'Determine which columns contain the data you need',
        'Plan your JOIN strategy (INNER, LEFT, etc.)',
        'Consider what conditions or aggregations are needed'
      ],
      explainWhy: 'Understanding table relationships is key to writing correct queries',
      error: null
    };
  } else {
    // High level - provide more specific guidance
    const schemaDetails = assignmentContext.sampleSchemas.map(s => {
      const cols = s.columns.map(c => `  - ${c.name} (${c.type})`).join('\n');
      return `Table: ${s.table}\n${cols}`;
    }).join('\n\n');
    
    return {
      hint: `Here's the detailed schema:\n\n${schemaDetails}\n\nAnalyze which columns you need and how to connect the tables using their key relationships.`,
      nextSteps: [
        'Write a SELECT clause with the specific columns needed',
        'Use JOIN clauses to connect related tables via foreign keys',
        'Add WHERE conditions to filter the results',
        'Include GROUP BY if you need aggregations',
        'Test your query incrementally, starting with a simple SELECT'
      ],
      explainWhy: 'Building queries step-by-step helps identify and fix errors early',
      error: null
    };
  }
};
