// app/api/ai-recipe/route.ts
import { NextResponse } from 'next/server';

const GEMINI_API_KEY = "AIzaSyAyIXnBHDjJ8oUaqAiH8cmXTwTHx6AK1u0";

export async function POST(req: Request) {
  try {
    const { type, content } = await req.json();

    let textToParse = content;
    if (type === 'url') {
      const response = await fetch(content, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (!response.ok) throw new Error("Failed to fetch the website content.");
      textToParse = await response.text(); 
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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
        { "quantity": 1, "unit": "cup", "name": "flour", "notes": "sifted" }
      ],
      "steps": [
        { "text": "First step instructions..." }
      ]
    }
    
    CRITICAL UNIT RULES:
    For the "unit" field in ingredients, you MUST use ONLY the following exact strings:
    'g', 'ml', 'tsp', 'tbsp', 'cup', 'lb', 'oz', 'whole', 'pinch', 'clove', 'can', 'slice', or "" (empty string).
    Convert full words to these abbreviations automatically (e.g., "teaspoon" -> "tsp", "tablespoons" -> "tbsp", "grams" -> "g", "ounces" -> "oz", "pounds" -> "lb", "milliliters" -> "ml").
    
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
    let rawJson = aiData.candidates[0].content.parts[0].text.trim();

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