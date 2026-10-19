import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  listCoreSmithingRecipes,
  upsertCoreSmithingRecipe,
  type SmithingRecipeInput,
} from "@/modules/character/services/smithing-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    return NextResponse.json({
      success: true,
      data: {
        recipes: await listCoreSmithingRecipes(true),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取炼器配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as SmithingRecipeInput;
    return NextResponse.json({
      success: true,
      data: {
        recipes: await upsertCoreSmithingRecipe(body),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存炼器配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
