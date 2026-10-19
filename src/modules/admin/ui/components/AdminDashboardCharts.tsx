"use client";

import { useMemo } from "react";
import { Column, Line, Pie } from "@ant-design/plots";
import { Card, Col, Empty, Row } from "antd";

type MetricItem = {
  label: string;
  value: number;
};

type TrendPoint = {
  date: string;
  newAccounts: number;
  newCharacters: number;
  combats: number;
};

export type AdminDashboardChartsProps = {
  contentItems: MetricItem[];
  trend7d: TrendPoint[];
  accountCoverageItems: MetricItem[];
  characterStatusItems: MetricItem[];
};

function toPlotData(items: MetricItem[]) {
  return items.map((item) => ({
    type: item.label,
    value: item.value,
  }));
}

export default function AdminDashboardCharts({
  contentItems,
  trend7d,
  accountCoverageItems,
  characterStatusItems,
}: AdminDashboardChartsProps) {
  const chartTextColor = "#d9d3c7";
  const chartMutedTextColor = "#b8b1a2";
  const chartAxisStrokeColor = "#2f3748";
  const chartGridColor = "rgba(128, 144, 172, 0.22)";

  const palette = useMemo(() => ({
    account: "#f0b74d",
    character: "#4cc9a7",
    combat: "#ff8f70",
    alive: "#59c58d",
    dead: "#a97758",
    withCharacter: "#f0b74d",
    withoutCharacter: "#6f8fb3",
    content: [
      "#f0b74d",
      "#4cc9a7",
      "#ff8f70",
      "#b685ff",
      "#6f8fb3",
      "#9ecb66",
      "#68b7ff",
    ],
  }), []);
  const axisStyle = useMemo(
    () => ({
      label: {
        style: {
          fill: chartTextColor,
          fontSize: 12,
        },
      },
      line: {
        style: {
          stroke: chartAxisStrokeColor,
        },
      },
      tickLine: {
        style: {
          stroke: chartAxisStrokeColor,
        },
      },
    }),
    [chartAxisStrokeColor, chartTextColor],
  );
  const yAxisStyle = useMemo(
    () => ({
      ...axisStyle,
      grid: {
        line: {
          style: {
            stroke: chartGridColor,
            lineDash: [4, 4],
          },
        },
      },
    }),
    [axisStyle, chartGridColor],
  );
  const legendStyle = useMemo(
    () => ({
      position: "bottom" as const,
      itemName: {
        style: {
          fill: chartTextColor,
        },
      },
      itemValue: {
        style: {
          fill: chartMutedTextColor,
        },
      },
    }),
    [chartMutedTextColor, chartTextColor],
  );
  const tooltipStyle = useMemo(
    () => ({
      domStyles: {
        "g2-tooltip": {
          backgroundColor: "#151c2d",
          color: "#e8e0d0",
          border: "1px solid #2f3748",
          borderRadius: "6px",
          boxShadow: "0 8px 20px rgba(0, 0, 0, 0.35)",
        },
        "g2-tooltip-title": {
          color: "#e8e0d0",
        },
        "g2-tooltip-list-item": {
          color: chartTextColor,
        },
      },
    }),
    [chartTextColor],
  );

  const contentData = useMemo(() => toPlotData(contentItems), [contentItems]);
  const accountCoverageData = useMemo(() => toPlotData(accountCoverageItems), [accountCoverageItems]);
  const characterStatusData = useMemo(() => toPlotData(characterStatusItems), [characterStatusItems]);
  const trendData = useMemo(() => {
    return trend7d.flatMap((item) => ([
      { date: item.date, type: "新增账号", value: item.newAccounts },
      { date: item.date, type: "新增角色", value: item.newCharacters },
      { date: item.date, type: "战斗次数", value: item.combats },
    ]));
  }, [trend7d]);
  const accountCoverageTotal = useMemo(
    () => accountCoverageData.reduce((sum, item) => sum + item.value, 0),
    [accountCoverageData],
  );
  const characterStatusTotal = useMemo(
    () => characterStatusData.reduce((sum, item) => sum + item.value, 0),
    [characterStatusData],
  );

  const contentConfig = useMemo(
    () => ({
      data: contentData,
      xField: "type",
      yField: "value",
      height: 260,
      colorField: "type",
      color: palette.content,
      legend: false,
      xAxis: axisStyle,
      yAxis: yAxisStyle,
      tooltip: tooltipStyle,
    }),
    [axisStyle, contentData, palette.content, tooltipStyle, yAxisStyle],
  );

  const trendConfig = useMemo(
    () => ({
      data: trendData,
      xField: "date",
      yField: "value",
      seriesField: "type",
      height: 300,
      smooth: true,
      point: { size: 3 },
      color: [palette.account, palette.character, palette.combat],
      legend: legendStyle,
      xAxis: axisStyle,
      yAxis: yAxisStyle,
      tooltip: tooltipStyle,
    }),
    [
      axisStyle,
      legendStyle,
      palette.account,
      palette.character,
      palette.combat,
      tooltipStyle,
      trendData,
      yAxisStyle,
    ],
  );

  const accountCoverageConfig = useMemo(
    () => ({
      data: accountCoverageData,
      angleField: "value",
      colorField: "type",
      height: 260,
      innerRadius: 0.62,
      color: [palette.withCharacter, palette.withoutCharacter],
      legend: legendStyle,
      tooltip: tooltipStyle,
    }),
    [
      accountCoverageData,
      legendStyle,
      palette.withCharacter,
      palette.withoutCharacter,
      tooltipStyle,
    ],
  );

  const characterStatusConfig = useMemo(
    () => ({
      data: characterStatusData,
      angleField: "value",
      colorField: "type",
      height: 260,
      innerRadius: 0.62,
      color: [palette.alive, palette.dead],
      legend: legendStyle,
      tooltip: tooltipStyle,
    }),
    [characterStatusData, legendStyle, palette.alive, palette.dead, tooltipStyle],
  );

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={12}>
        <Card size="small" title="内容分布">
          {contentData.length > 0 ? (
            <Column {...contentConfig} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无内容数据" />
          )}
        </Card>
      </Col>

      <Col xs={24} xl={12}>
        <Card size="small" title="近 7 天趋势（账号 / 角色 / 战斗）">
          {trendData.length > 0 ? (
            <Line {...trendConfig} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" />
          )}
        </Card>
      </Col>

      <Col xs={24} xl={12}>
        <Card size="small" title="账号角色覆盖率（账号）">
          {accountCoverageTotal > 0 ? (
            <Pie {...accountCoverageConfig} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无账号数据" />
          )}
        </Card>
      </Col>

      <Col xs={24} xl={12}>
        <Card size="small" title="角色生存状态（角色）">
          {characterStatusTotal > 0 ? (
            <Pie {...characterStatusConfig} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无角色数据" />
          )}
        </Card>
      </Col>
    </Row>
  );
}
