"use client";

import { useEffect } from "react";
import { Button, Modal, Typography, Space } from "antd";
import { GiftOutlined } from "@ant-design/icons";
import DarkTag from "@/modules/shared/ui/components/DarkTag";
import GameImage from "@/modules/shared/ui/components/GameImage";
import ItemBadge from "@/modules/shared/ui/components/ItemBadge";
import type { MapEncounterSessionView, MapEncounterStageView } from "@/types/game";

const { Text, Paragraph } = Typography;

export interface EventRewardData {
  xp?: number;
  gold?: number;
  items?: { itemId: string; itemName: string; itemIconUrl?: string | null; quantity: number }[];
  fortunes?: { fortuneId: string; fortuneName: string }[];
  removedFortunes?: { fortuneId: string; fortuneName: string }[];
  actions?: Array<{
    type: string;
    label?: string;
    targetVar?: string;
    targetName?: string;
    targetKind?: "player" | "monster";
    logId?: number;
    monsterId?: string;
    mapId?: string;
    navigatePath?: string;
  }>;
}

export interface EventResultData {
  name: string;
  type: string;
  narrative: string;
  imageUrl?: string | null;
  rewards?: EventRewardData | null;
}

export interface EncounterStageModalData {
  mode: "encounter-stage";
  encounterSession: MapEncounterSessionView;
  stage: MapEncounterStageView;
}

export type EventModalData = EventResultData | EncounterStageModalData;

interface EventModalProps {
  event: EventModalData | null;
  open: boolean;
  onClose: () => void;
  onChoice?: (choiceId: string) => void;
  choiceLoading?: boolean;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  encounter: "#d4545d",
  opportunity: "#c9a84c",
};

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function isEncounterStageEvent(event: EventModalData | null): event is EncounterStageModalData {
  return Boolean(event && "mode" in event && event.mode === "encounter-stage");
}

export default function EventModal({ event, open, onClose, onChoice, choiceLoading = false }: EventModalProps) {
  useEffect(() => {
    if (!open || !event) return;

    const handleKeydown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== "Enter") return;
      if (isEncounterStageEvent(event)) return;
      keyboardEvent.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [event, open, onClose]);

  if (!event) return null;

  if (isEncounterStageEvent(event)) {
    const { stage, encounterSession } = event;
    return (
      <Modal
        title={
          <Space>
            <GiftOutlined style={{ color: EVENT_TYPE_COLORS[encounterSession.eventType] || "#c9a84c" }} />
            <span style={{ color: "#c9a84c" }}>{encounterSession.eventName}</span>
          </Space>
        }
        open={open}
        footer={null}
        closable={false}
        maskClosable={false}
        onCancel={() => undefined}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(201, 168, 76, 0.12)",
            border: "1px solid #6b5a2f",
          }}>
            <Text style={{ color: "#f0d89b" }}>{stage.title}</Text>
            <Text style={{ color: "#c9a84c", fontSize: 12 }}>
              第 {stage.stageNumber} / {stage.totalStages} 段
            </Text>
          </div>
          {stage.pathSummary && stage.pathSummary.length > 0 && (
            <Space wrap size={[6, 6]}>
              {stage.pathSummary.map((item) => (
                <DarkTag key={item} color="purple">已选·{item}</DarkTag>
              ))}
            </Space>
          )}
          <Paragraph style={{ color: "#e8e0d0", whiteSpace: "pre-wrap", lineHeight: 1.8, marginBottom: 0 }}>
            {stage.narrative}
          </Paragraph>
          {stage.imageUrl && (
            <GameImage
              src={stage.imageUrl}
              alt={`${encounterSession.eventName}插图`}
              width={720}
              height={360}
              style={{
                width: "100%",
                maxHeight: 260,
                objectFit: "cover",
                borderRadius: 6,
                border: "1px solid #3b3220",
                display: "block",
              }}
            />
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {stage.choices.map((choice) => (
              <Button
                key={choice.id}
                block
                type="primary"
                disabled={choiceLoading}
                loading={choiceLoading}
                onClick={() => onChoice?.(choice.id)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        </div>
      </Modal>
    );
  }

  const xpValue = Number(event.rewards?.xp || 0);
  const goldValue = Number(event.rewards?.gold || 0);

  return (
    <Modal
      title={
        <Space>
          <GiftOutlined style={{ color: EVENT_TYPE_COLORS[event.type] || "#c9a84c" }} />
          <span style={{ color: "#c9a84c" }}>{event.name}</span>
        </Space>
      }
      open={open}
      onOk={onClose}
      onCancel={onClose}
      cancelButtonProps={{ style: { display: "none" } }}
      okText="知道了"
    >
      <Paragraph style={{ color: "#e8e0d0", whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
        {event.narrative}
      </Paragraph>
      {event.imageUrl && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <GameImage
            src={event.imageUrl}
            alt={`${event.name}插图`}
            width={720}
            height={360}
            style={{
              width: "100%",
              maxHeight: 260,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid #3b3220",
              display: "block",
            }}
          />
        </div>
      )}
      {event.rewards && (
        <div style={{
          background: "rgba(201, 168, 76, 0.1)",
          border: "1px solid #6b5a2f",
          borderRadius: 4,
          padding: "8px 12px",
          marginTop: 12,
        }}>
          <Text style={{ color: "#c9a84c", fontSize: 12 }}>事件结果：</Text>
          <div style={{ marginTop: 4 }}>
            {xpValue !== 0 && <DarkTag color={xpValue > 0 ? "blue" : "red"}>修为 {formatSignedNumber(xpValue)}</DarkTag>}
            {goldValue !== 0 && <DarkTag color={goldValue > 0 ? "gold" : "red"}>灵石 {formatSignedNumber(goldValue)}</DarkTag>}
            {event.rewards.items?.map((item, i) => (
              <ItemBadge
                key={`${item.itemId}-${i}`}
                name={item.itemName}
                iconUrl={item.itemIconUrl}
                quantity={item.quantity}
                iconSize={12}
              />
            ))}
            {event.rewards.fortunes?.map((fortune) => (
              <DarkTag key={fortune.fortuneId} color="purple">气运·{fortune.fortuneName}</DarkTag>
            ))}
            {event.rewards.removedFortunes?.map((fortune) => (
              <DarkTag key={`removed-${fortune.fortuneId}`} color="red">气运失去·{fortune.fortuneName}</DarkTag>
            ))}
            {event.rewards.actions?.map((action, index) => (
              <DarkTag key={`${action.type}-${action.logId || "na"}-${index}`} color="purple">
                {action.label || `${action.type}${action.targetName ? `·${action.targetName}` : ""}`}
              </DarkTag>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
