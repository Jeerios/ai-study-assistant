import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});



type Mode = "explain" | "quiz" | "practice";

function buildPrompt(notes: string, mode: Mode) {
  const system =
    "You are a helpful study assistant. Be clear, step-by-step, and student-friendly. Use headings and bullet points when useful.";

  let user = "";

  if (mode === "explain") {
    user = `Explain these notes step-by-step. Then give 3 example questions with worked solutions.\n\nNOTES:\n${notes}`;
  } else if (mode === "quiz") {
    user = `Create a quiz from these notes: 8 multiple choice and 3 short answer. Include an answer key.\n\nNOTES:\n${notes}`;
  } else if (mode === "practice") {
    user = `Generate 5 practice problems based on these notes (easy → harder). Provide worked solutions for each.\n\nNOTES:\n${notes}`;
  }

  return { system, user };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { notes, mode } = body as { notes?: string; mode?: Mode };

    // Validate inputs
    if (!notes || typeof notes !== "string" || notes.trim().length < 10) {
      return NextResponse.json(
        { error: "Please provide at least 10 characters of notes." },
        { status: 400 }
      );
    }

    if (!mode || !["explain", "quiz", "practice"].includes(mode)) {
      return NextResponse.json({ error: "Invalid mode." }, { status: 400 });
    }

    // Validate API key
    if (!process.env.GROQ_API_KEY) {
  return NextResponse.json(
    { error: "Missing GROQ_API_KEY in .env.local" },
    { status: 500 }
  );
}


    const { system, user } = buildPrompt(notes, mode);

    let completion;
try {
  completion = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
  });
} catch (e: any) {
  console.error("GROQ CALL FAILED:", e?.response?.data || e?.message || e);
  return NextResponse.json(
    { error: e?.response?.data || e?.message || "Groq call failed" },
    { status: 500 }
  );
}


    const result = completion.choices[0]?.message?.content ?? "No response.";

    return NextResponse.json({ result });
  } catch (err: any) {
  console.error("GROQ API ERROR:", err);
  return NextResponse.json(
    { error: err?.message || "Server error" },
    { status: 500 }
  );
}

}
