"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Empty, Progress, Space, Spin, Typography } from "antd";
import {
  ArrowLeftOutlined,
  FireOutlined,
  HistoryOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import ItemIcon from "@/modules/shared/ui/components/ItemIcon";
import MissingMaterialModal, {
  type MissingMaterial,
} from "@/modules/character/ui/components/MissingMaterialModal";
import {
  buildCultivationActionButtonStyle,
  cultivationPageWideShellStyle,
  cultivationSectionCardStyle,
  cultivationSoftPanelStyle,
} from "@/modules/shared/ui/utils/cultivation-page-theme";

const { Text } = Typography;

type SmithingIngredientView = {
  itemId: string;
  itemName: string;
  quantity: number;
  ownedQuantity: number;
  enough: boolean;
  bonusRate: number;
  role: "main" | "auxA" | "auxB" | "auxC";
};

type SmithingRecipeView = {
  id: string;
  resultItemId: string;
  resultItemName: string;
  resultItemIconUrl: string | null;
  resultItemType: string;
  resultQuantity: number;
  baseSuccessRate: number;
  currentSuccessRate: number;
  pityBonusRate: number;
  failureStreak: number;
  enabled: boolean;
  ingredients: SmithingIngredientView[];
  canCraft: boolean;
  requiredRealm: number | null;
  materialRequiredRealm: number;
  requiredRealmName: string | null;
  materialRequiredRealmName: string | null;
};

type SmithingView = {
  playerRealm: number;
  playerRealmName: string;
  recipes: SmithingRecipeView[];
  recentLogs: Array<{
    recipeId: string;
    resultItemName: string;
    success: boolean;
    finalSuccessRate: number;
    createdAt: string;
  }>;
};

function formatRate(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
}

function formatIngredientRole(role: SmithingIngredientView["role"]) {
  if (role === "main") {
    return "主材";
  }
  return "辅材";
}

function formatItemType(type: string) {
  const map: Record<string, string> = {
    weapon: "武器",
    armor: "法衣",
    helmet: "冠",
    shoes: "履",
    artifact: "法宝",
  };
  return map[type] || type || "器物";
}

export default function SmithingPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [craftingRecipeId, setCraftingRecipeId] = useState<string | null>(null);
  const [view, setView] = useState<SmithingView | null>(null);
  const [missingMaterials, setMissingMaterials] = useState<{
    title: string;
    materials: MissingMaterial[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/game/smithing", { cache: "no-store" });
      const json = await response.json();
      if (!json.success) {
        message.error(json.error || "获取炼器失败");
        return;
      }
      setView(json.data);
    } catch {
      message.error("获取炼器失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const craft = async (recipe: SmithingRecipeView) => {
    // 材料不够时不静默失败，先告诉玩家缺什么、去哪弄
    if (!recipe.canCraft) {
      const materials = recipe.ingredients
        .filter((ingredient) => !ingredient.enough)
        .map((ingredient) => ({
          itemId: ingredient.itemId,
          itemName: ingredient.itemName,
          required: ingredient.quantity,
          owned: ingredient.ownedQuantity,
          missing: Math.max(0, ingredient.quantity - ingredient.ownedQuantity),
        }));
      setMissingMaterials({
        title: `炼制「${recipe.resultItemName}」还缺 ${materials.length} 种材料`,
        materials,
      });
      return;
    }

    setCraftingRecipeId(recipe.id);
    try {
      const response = await fetch("/api/game/smithing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "craft", recipeId: recipe.id }),
      });
      const json = await response.json();
      if (!json.success) {
        message.warning(json.error || "炼器失败");
        return;
      }
      setView(json.data);
      const latest = json.data?.recentLogs?.[0];
      message.success(latest?.success ? `炼成 ${recipe.resultItemName}` : "炼器未成，炉火已记入");
    } catch {
      message.error("炼器失败");
    } finally {
      setCraftingRecipeId(null);
    }
  };

  const renderRecipe = (recipe: SmithingRecipeView) => {
    const isCrafting = craftingRecipeId === recipe.id;
    const playerRealm = view?.playerRealm ?? 0;
    // 做出来的东西穿不上 / 材料现在还弄不到，都在卡片上提前说清楚
    const equipBlocked = recipe.requiredRealm !== null && recipe.requiredRealm > playerRealm;
    const materialBlocked = recipe.materialRequiredRealm > playerRealm;
    const realmBlocked = equipBlocked || materialBlocked;
    const primaryStyle = buildCultivationActionButtonStyle({ active: recipe.canCraft && !realmBlocked, dreamy: true });
    const normalStyle = buildCultivationActionButtonStyle({ dreamy: true });

    return (
      <Card
        key={recipe.id}
        size="small"
        style={{ ...cultivationSectionCardStyle, borderRadius: 8, marginBottom: 8 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
            {recipe.resultItemIconUrl ? (
              <ItemIcon iconUrl={recipe.resultItemIconUrl} size={38} borderColor="#4a3820" />
            ) : (
              <ToolOutlined style={{ color: "#c9a84c", fontSize: 28, width: 38, lineHeight: "38px", textAlign: "center" }} />
            )}
            <div style={{ minWidth: 0 }}>
              <Space size={5} wrap>
                <Text style={{ color: "#e8e0d0", fontWeight: 700 }}>{recipe.resultItemName}</Text>
                <DarkTag color="#c9a84c" style={{ fontSize: 10, padding: "0 4px" }}>
                  {formatItemType(recipe.resultItemType)}
                </DarkTag>
                {recipe.requiredRealmName && (
                  <DarkTag color={equipBlocked ? "#d0705a" : "#8e856e"} style={{ fontSize: 10, padding: "0 4px" }}>
                    {recipe.requiredRealmName}
                  </DarkTag>
                )}
              </Space>
              <Text style={{ color: "#8e856e", fontSize: 11, display: "block", marginTop: 4 }}>
                成器 {formatRate(recipe.currentSuccessRate)} · 基础 {formatRate(recipe.baseSuccessRate)}
              </Text>
              {realmBlocked && (
                <Text style={{ color: "#d0705a", fontSize: 11, display: "block", marginTop: 2 }}>
                  {[
                    equipBlocked ? `需 ${recipe.requiredRealmName} 才能装备` : null,
                    materialBlocked ? `材料需 ${recipe.materialRequiredRealmName}` : null,
                  ].filter(Boolean).join(" · ")}
                  {`（当前 ${view?.playerRealmName ?? playerRealm}）`}
                </Text>
              )}
            </div>
          </div>
          <Button
            size="small"
            type={recipe.canCraft && !realmBlocked ? "primary" : "default"}
            icon={<FireOutlined />}
            loading={isCrafting}
            disabled={craftingRecipeId !== null}
            style={recipe.canCraft && !realmBlocked ? primaryStyle : normalStyle}
            onClick={() => { void craft(recipe); }}
          >
            炼制
          </Button>
        </div>

        <div style={{ marginTop: 8 }}>
          <Progress
            percent={Math.round(recipe.currentSuccessRate * 100)}
            showInfo={false}
            size="small"
            strokeColor={recipe.canCraft ? "#c9a84c" : "#6b6355"}
          />
          <Space size={5} wrap style={{ marginTop: 5 }}>
            <DarkTag color={recipe.pityBonusRate > 0 ? "#e879a6" : "#6b6355"} style={{ fontSize: 10, padding: "0 4px" }}>
              软保底 {formatRate(recipe.pityBonusRate)}
            </DarkTag>
            <DarkTag color={recipe.failureStreak > 0 ? "#e879a6" : "#6b6355"} style={{ fontSize: 10, padding: "0 4px" }}>
              连续未成 {recipe.failureStreak}
            </DarkTag>
          </Space>
        </div>

        <div style={{ ...cultivationSoftPanelStyle, padding: 7, marginTop: 8 }}>
          <Space size={[5, 5]} wrap>
            {recipe.ingredients.map((ingredient) => (
              <DarkTag
                key={`${recipe.id}-${ingredient.role}-${ingredient.itemId}`}
                color={ingredient.enough ? "#52b788" : "#ff7875"}
                style={{ fontSize: 10, padding: "0 4px" }}
              >
                {formatIngredientRole(ingredient.role)} {ingredient.itemName} {ingredient.ownedQuantity}/{ingredient.quantity}
                {ingredient.bonusRate > 0 ? ` +${formatRate(ingredient.bonusRate)}` : ""}
              </DarkTag>
            ))}
          </Space>
        </div>
      </Card>
    );
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ ...cultivationPageWideShellStyle, padding: 8 }}>
      <div style={{ marginBottom: 8 }}>
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => router.push("/game/character")}>
          返回角色
        </Button>
      </div>

      <Card size="small" style={{ ...cultivationSectionCardStyle, borderRadius: 8, marginBottom: 8 }}>
        <Space size={6} wrap>
          <ToolOutlined style={{ color: "#c9a84c" }} />
          <Text style={{ color: "#e8e0d0", fontWeight: 700 }}>炼器</Text>
          <DarkTag color="#c9a84c">配方 {view?.recipes.length || 0}</DarkTag>
          <DarkTag color="#6b8cff">近况 {view?.recentLogs.length || 0}</DarkTag>
        </Space>
      </Card>

      {view?.recipes?.length ? view.recipes.map(renderRecipe) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>暂无炼器配方</Text>} />
      )}

      <MissingMaterialModal
        open={missingMaterials !== null}
        title={missingMaterials?.title}
        materials={missingMaterials?.materials || []}
        onClose={() => setMissingMaterials(null)}
      />

      <Card
        size="small"
        title={<Text style={{ color: "#e8e0d0" }}><HistoryOutlined /> 最近炉火</Text>}
        style={{ ...cultivationSectionCardStyle, borderRadius: 8, marginTop: 8 }}
      >
        {view?.recentLogs?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {view.recentLogs.map((log, index) => (
              <div
                key={`${log.recipeId}-${log.createdAt}-${index}`}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}
              >
                <Text style={{ color: "#a09880", fontSize: 11 }}>{log.resultItemName}</Text>
                <Space size={5}>
                  <DarkTag color={log.success ? "#52b788" : "#ff7875"} style={{ fontSize: 10, padding: "0 4px" }}>
                    {log.success ? "成器" : "未成"}
                  </DarkTag>
                  <Text style={{ color: "#6b6355", fontSize: 11 }}>{formatRate(log.finalSuccessRate)}</Text>
                </Space>
              </div>
            ))}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text style={{ color: "#6b6355" }}>暂无炼器记录</Text>} />
        )}
      </Card>
    </div>
  );
}
