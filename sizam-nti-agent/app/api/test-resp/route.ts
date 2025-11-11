// app/api/test-resp/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const project = process.env.OPENAI_PROJECT_ID;
    const organization = process.env.OPENAI_ORG_ID; // можно не задавать

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "NO_API_KEY" }, { status: 500 });
    }

    const client = new OpenAI(
      organization
        ? { apiKey, project, organization }
        : project
        ? { apiKey, project }
        : { apiKey }
    );

    const resp = await client.responses.create({
      model: "gpt-4o",
      input: [{ role: "user", content: "Скажи 'ok'." }],
    });

    console.log("TEST_RESP_RAW:", JSON.stringify(resp, null, 2));

    return NextResponse.json(
      {
        ok: true,
        output: resp.output_text ?? null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("TEST_RESP_ERROR:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "unknown",
      },
      { status: 500 }
    );
  }
}

