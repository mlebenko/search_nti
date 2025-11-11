// app/api/test-resp/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const project = process.env.OPENAI_PROJECT_ID; // может быть undefined

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "NO_API_KEY" },
        { status: 500 }
      );
    }

    const client = new OpenAI(
      project
        ? { apiKey, project }
        : { apiKey } // если проекта нет — пробуем так
    );

    const resp = await client.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "user",
          content: "Скажи 'ok'.",
        },
      ],
      // специально без web_search, чтобы проверить именно доступ к responses.write
    });

    console.log("TEST_RESP_RAW:", JSON.stringify(resp, null, 2));

    return NextResponse.json({
      ok: true,
      output: resp.output_text ?? null,
    });
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
