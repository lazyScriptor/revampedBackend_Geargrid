import Anthropic from "@anthropic-ai/sdk";
import AppError from "../utils/AppError.js";

const MODEL = process.env.TRANSLATE_MODEL || "claude-opus-5-5";
const BATCH = 50;

const SYSTEM = [
  "You translate names of construction / heavy-tool / event rental equipment into natural Sinhala as written by Sri Lankan equipment-rental shops.",
  "Use the Sinhala word a Sri Lankan contractor would actually say. Common machines often keep their English brand/model: keep brand names, model numbers, sizes and units (e.g. Bosch, 800W, 2HP, 5m, 20L) in Latin script and translate only the descriptive words (drill → ඩ්‍රිල්, hammer drill → හැමර් ඩ්‍රිල්, generator → ජනක යන්ත්‍රය, concrete mixer → කොන්ක්‍රීට් මික්සරය, scaffolding → ස්කෆෝල්ඩින්, ladder → ඉණිමඟ, water pump → වතුර පොම්පය, compressor → කම්ප්‍රෙසරය, welding machine → වෙල්ඩින් යන්ත්‍රය, cutter → කටරය, chair → පුටුව, tent → කූඩාරම).",
  "Keep it short — a label, not a sentence. Do not add explanations.",
  'Reply with ONLY a JSON object that maps each given id (as a string) to its Sinhala name.',
].join("\n");

/**
 * @param {Array<{id:number,name:string}>} items
 * @returns {Promise<Map<number,string>>} id → Sinhala name (missing ids = could not translate)
 */
export const translateNamesToSinhala = async (items) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError(
      "Automatic translation is not set up on the server yet (ANTHROPIC_API_KEY is missing). Type the Sinhala names manually or ask your administrator to enable it.",
      503,
    );
  }
  const client = new Anthropic();
  const result = new Map();

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const payload = Object.fromEntries(batch.map((b) => [String(b.id), b.name]));
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed = {};
    try {
      parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      continue; // leave this batch untranslated rather than failing the whole run
    }
    for (const b of batch) {
      const si = typeof parsed[String(b.id)] === "string" ? parsed[String(b.id)].trim().slice(0, 255) : "";
      if (si) result.set(b.id, si);
    }
  }
  return result;
};
