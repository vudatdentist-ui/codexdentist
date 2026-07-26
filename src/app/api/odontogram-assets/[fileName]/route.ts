import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const generatedAssetPattern =
  /^(11|13|14|16)-(adult|primary)-(implant|bone|boneLoss|boneLossOnly|implantBoneLoss|pulpitis|periodontitis|periapical|rootCanal|crown|extraction)\.svg$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await context.params;

  if (!generatedAssetPattern.test(fileName)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const asset = await readFile(
      path.join(process.cwd(), "public", "odontogram-assets", fileName),
    );

    return new NextResponse(asset, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
