import { NextResponse } from "next/server";
import { requireAdminApi } from "@/modules/auth/services/admin-auth";
import {
  listCoreAlchemyRecipes,
  upsertCoreAlchemyRecipe,
  type AlchemyRecipeInput,
} from "@/modules/character/services/alchemy-service";

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
        recipes: await listCoreAlchemyRecipes(true),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "获取炼丹配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.response) {
    return auth.response;
  }

  try {
    const body = await request.json() as AlchemyRecipeInput;
    return NextResponse.json({
      success: true,
      data: {
        recipes: await upsertCoreAlchemyRecipe(body),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存炼丹配置失败";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
