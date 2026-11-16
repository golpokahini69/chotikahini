import { NextResponse } from "next/server";
import { translateText } from "@/lib/translate";

export const dynamic = 'force-dynamic';

/**
 * Fast Google Translate API with Parallel Batch Execution
 * Translates English/Banglish text to Bengali fast & free while preserving Markdown!
 *
 * The actual request lives in `lib/translate.ts` so the slug generator
 * (which translates Bengali → English) shares one implementation.
 */
async function translateChunk(text: string): Promise<string> {
  return translateText(text, "bn");
}

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text || !text.trim()) {
      return NextResponse.json({ translatedText: "" });
    }

    const sourceText = text.trim();

    // Group lines into chunks of up to 1000 characters to minimize network requests while maintaining instant speed
    const lines = sourceText.split("\n");
    const chunks: string[] = [];
    let currentChunk = "";

    for (const line of lines) {
      if ((currentChunk + "\n" + line).length > 1000) {
        chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // Execute translation chunks concurrently via Promise.all for maximum speed
    const translatedChunks = await Promise.all(
      chunks.map(chunk => translateChunk(chunk))
    );

    const translatedText = translatedChunks.join("\n");

    return NextResponse.json({ success: true, translatedText });
  } catch (error) {
    console.error("Translation API error:", error);
    return NextResponse.json({ error: "অনুবাদ করতে সমস্যা হয়েছে।" }, { status: 500 });
  }
}
