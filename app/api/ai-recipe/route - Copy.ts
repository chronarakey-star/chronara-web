// app/api/ai-recipe/route.ts
import { NextResponse } from 'next/server';

// Pulls the key securely from your hidden .env.local file
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: Request) {
  try {
    const { type, content } = await req.json();

    let textToParse = content;
    if (type === 'url') {
      // Upgraded User-Agent so food blogs don't block the scraper as a "bot"
      const response = await fetch(content, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      });
      if (!response.ok) throw new Error(`Website blocked the request. Status: ${response.status}`);
      textToParse = await response.text(); 
    }

    // MATCHING CHRONARA KEY: Upgraded to Gemini 2.5 Pro
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `
    You are an expert culinary AI. Extract the recipe from the following text or HTML.
    Return ONLY a raw JSON object matching this structure exactly (do not include markdown formatting like \`\`\`json):
    {
      "title": "Recipe Name",
      "description": "Short description or history",
      "servings": 4,
      "prep_min": 15,
      "cook_min": 30,
      "categories": ["Dinner"],
      "ingredients": [
        { "quantity": 1, "unit": "cup", "name": "Flour", "notes": "sifted" }
      ],
      "steps": [
        { "text": "First step instructions..." }
      ]
    }
    
    CRITICAL FORMATTING RULES:
    1. UNITS: For the "unit" field in ingredients, you MUST use ONLY the following exact strings:
    'g', 'ml', 'tsp', 'tbsp', 'cup', 'lb', 'oz', 'whole', 'pinch', 'clove', 'can', 'slice', or "" (empty string).
    Convert full words to these abbreviations automatically (e.g., "teaspoon" -> "tsp", "tablespoons" -> "tbsp").
    2. INGREDIENT NAMES: You MUST format all ingredient "name" fields in Title Case (e.g., "Pizza Dough", "Unsalted Butter", "Salt"). Do not leave them entirely lowercase.
    
    If a field is unknown, use 0 for numbers, "" for strings, and [] for arrays. Keep instructions concise and clean.
    
    DATA TO PARSE:
    ${textToParse}
    `;

    const aiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const aiData = await aiRes.json();

    // --- STRICT ERROR HANDLING ---
    // 1. Did the API return a hard error? (e.g., Quota exceeded, Bad API Key, Wrong Model)
    if (aiData.error) {
      throw new Error(`Gemini API Error: ${aiData.error.message}`);
    }

    // 2. Did Gemini block the prompt for safety reasons?
    if (!aiData.candidates || aiData.candidates.length === 0) {
      console.error("Empty AI Data:", JSON.stringify(aiData, null, 2));
      throw new Error("Gemini returned an empty response. The content may have been blocked by safety filters.");
    }

    let rawJson = aiData.candidates[0].content?.parts?.[0]?.text;
    
    if (!rawJson) {
      throw new Error("AI successfully connected, but failed to generate text.");
    }

    // Clean up markdown wrapping if the AI includes it
    rawJson = rawJson.trim();
    if (rawJson.startsWith('```json')) rawJson = rawJson.slice(7);
    if (rawJson.startsWith('```')) rawJson = rawJson.slice(3);
    if (rawJson.endsWith('```')) rawJson = rawJson.slice(0, -3);

    const parsedRecipe = JSON.parse(rawJson.trim());
    return NextResponse.json({ success: true, recipe: parsedRecipe });

  } catch (error: any) {
    console.error("AI Route Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}