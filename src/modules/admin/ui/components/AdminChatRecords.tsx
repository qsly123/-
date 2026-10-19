"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, DatePicker, Input, Popconfirm, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";

const { RangePicker } = DatePicker;
const { Search } = Input;
const { Text } = Typography;

type ChatTab = "world" | "dm";

type WorldMessageRow = {
  id: number;
  messageType: "player" | "system";
  playerId: string | null;
  senderName: string;
  content: string;
  createdAt: string;
};

type DmMessageRow = {
  id: number;
  conversationId: string;
  senderPlayerId: string;
  senderName: string;
  content: string;
  createdAt: string;
};

type ListResponse = {
  success: boolean;
  error?: string;
  data?: {
    tab: ChatTab;
    list: WorldMessageRow[] | DmMessageRow[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
    };
  };
};

type DeleteResponse = {
  success: boolean;
  error?: string;
  data?: {
    deletedCount: number;
  };
};

type RangeValue = [Dayjs | null, Dayjs | null] | null;

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function toIsoRange(range: RangeValue) {
  return {
    startAt: range?.[0] ? range[0].toDate().toISOString() : undefined,
    endAt: range?.[1] ? range[1].toDate().toISOString() : undefined,
  };
}

function messageTypeTag(value: string) {
  if (value === "system") {
    return <Tag color="gold">系统</Tag>;
  }
  return <Tag color="blue">玩家</Tag>;
}

export default function AdminChatRecords() {
  const { message } = App.useApp();

  const [tab, setTab] = useState<ChatTab>("world");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [timeRange, setTimeRange] = useState<RangeValue>(null);
  const [worldList, setWorldList] = useState<WorldMessageRow[]>([]);
  const [dmList, setDmList] = useState<DmMessageRow[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const activeList = useMemo(
    () => (tab === "world" ? worldList : dmList),
    [dmList, tab, worldList],
  );

  const fetchList = useCallback(async (input: {
    page: number;
    pageSize: number;
    tab: ChatTab;
    keyword: string;
    timeRange: RangeValue;
  }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tab: input.tab,
        page: String(input.page),
        pageSize: String(input.pageSize),
      });

      const trimmedKeyword = input.keyword.trim();
      if (trimmedKeyword) {
        params.set("keyword", trimmedKeyword);
      }

      const { startAt, endAt } = toIsoRange(input.timeRange);
      if (startAt) {
        params.set("startAt", startAt);
      }
      if (endAt) {
        params.set("endAt", endAt);
      }

      const res = await fetch(`/api/admin/chat-records?${params.toString()}`, { cache: "no-store" });
      const json = await res.json() as ListResponse;

      if (!json.success || !json.data) {
        message.error(json.error || "加载失败");
        return;
      }

      if (json.data.tab === "world") {
        setWorldList(json.data.list as WorldMessageRow[]);
      } else {
        setDmList(json.data.list as DmMessageRow[]);
      }

      setPage(json.data.pagination.page);
      setPageSize(json.data.pagination.pageSize);
      setTotal(json.data.pagination.total);
      setSelectedRowKeys([]);
    } catch {
      message.error("加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchList({
      page: 1,
      pageSize: 20,
      tab: "world",
      keyword: "",
      timeRange: null,
    });
  }, [fetchList]);

  const handleDelete = useCallback(async (ids: number[]) => {
    if (!ids.length) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch("/api/admin/chat-records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab,
          ids,
        }),
      });
      const json = await res.json() as DeleteResponse;
      if (!json.success) {
        message.error(json.error || "删除失败");
        return;
      }

      const deletedCount = json.data?.deletedCount ?? ids.length;
      message.success(`删除成功，共 ${deletedCount} 条`);
      await fetchList({
        page,
        pageSize,
        tab,
        keyword,
        timeRange,
      });
    } catch {
      message.error("删除失败");
    } finally {
      setDeleting(false);
    }
  }, [fetchList, keyword, message, page, pageSize, tab, timeRange]);

  const handleRangeCleanup = useCallback(async () => {
    const { startAt, endAt } = toIsoRange(timeRange);
    if (!startAt && !endAt) {
      message.error("请先选择时间范围");
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch("/api/admin/chat-records", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab,
          startAt,
          endAt,
        }),
      });
      const json = await res.json() as DeleteResponse;
      if (!json.success) {
        message.error(json.error || "清理失败");
        return;
      }

      message.success(`清理完成，共 ${json.data?.deletedCount || 0} 条`);
      await fetchList({
        page: 1,
        pageSize,
        tab,
        keyword,
        timeRange,
      });
    } catch {
      message.error("清理失败");
    } finally {
      setDeleting(false);
    }
  }, [fetchList, keyword, message, pageSize, tab, timeRange]);

  const worldColumns: ColumnsType<WorldMessageRow> = useMemo(() => [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 100,
    },
    {
      title: "类型",
      dataIndex: "messageType",
      key: "messageType",
      width: 100,
      render: (value: WorldMessageRow["messageType"]) => messageTypeTag(value),
    },
    {
      title: "发送者",
      dataIndex: "senderName",
      key: "senderName",
      width: 160,
      ellipsis: true,
    },
    {
      title: "玩家ID",
      dataIndex: "playerId",
      key: "playerId",
      width: 180,
      ellipsis: true,
      render: (value: string | null) => value || "-",
    },
    {
      title: "内容",
      dataIndex: "content",
      key: "content",
      ellipsis: true,
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 190,
      render: (value: string) => formatTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 110,
      render: (_, record) => (
        <Popconfirm
          title={`确认删除 ID=${record.id} 的记录？`}
          okText="删除"
          cancelText="取消"
          onConfirm={() => void handleDelete([record.id])}
        >
          <Button size="small" danger loading={deleting}>删除</Button>
        </Popconfirm>
      ),
    },
  ], [deleting, handleDelete]);

  const dmColumns: ColumnsType<DmMessageRow> = useMemo(() => [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 100,
    },
    {
      title: "发送者",
      dataIndex: "senderName",
      key: "senderName",
      width: 160,
      ellipsis: true,
    },
    {
      title: "发送者ID",
      dataIndex: "senderPlayerId",
      key: "senderPlayerId",
      width: 180,
      ellipsis: true,
    },
    {
      title: "会话ID",
      dataIndex: "conversationId",
      key: "conversationId",
      width: 240,
      ellipsis: true,
      render: (value: string) => (
        <Text style={{ fontFamily: "monospace" }} ellipsis={{ tooltip: value }}>
          {value}
        </Text>
      ),
    },
    {
      title: "内容",
      dataIndex: "content",
      key: "content",
      ellipsis: true,
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 190,
      render: (value: string) => formatTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 110,
      render: (_, record) => (
        <Popconfirm
          title={`确认删除 ID=${record.id} 的记录？`}
          okText="删除"
          cancelText="取消"
          onConfirm={() => void handleDelete([record.id])}
        >
          <Button size="small" danger loading={deleting}>删除</Button>
        </Popconfirm>
      ),
    },
  ], [deleting, handleDelete]);

  return (
    <Card title="聊天记录管理">
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          const nextTab = key as ChatTab;
          setTab(nextTab);
          setPage(1);
          setSelectedRowKeys([]);
          void fetchList({
            page: 1,
            pageSize,
            tab: nextTab,
            keyword,
            timeRange,
          });
        }}
        items={[
          { key: "world", label: "全服聊天" },
          { key: "dm", label: "私聊记录" },
        ]}
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Search
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={tab === "world" ? "搜索发送者/玩家ID/内容" : "搜索发送者/发送者ID/会话ID/内容"}
          allowClear
          style={{ width: 320 }}
          onSearch={() => void fetchList({
            page: 1,
            pageSize,
            tab,
            keyword,
            timeRange,
          })}
        />
        <RangePicker
          showTime
          value={timeRange}
          onChange={(values) => setTimeRange(values)}
          placeholder={["开始时间", "结束时间"]}
        />
        <Button
          onClick={() => void fetchList({
            page: 1,
            pageSize,
            tab,
            keyword,
            timeRange,
          })}
          loading={loading}
        >
          查询
        </Button>
        <Button
          onClick={() => {
            setKeyword("");
            setTimeRange(null);
            void fetchList({
              page: 1,
              pageSize,
              tab,
              keyword: "",
              timeRange: null,
            });
          }}
        >
          重置
        </Button>
        <Popconfirm
          title={`确认按时间范围清理当前Tab（${tab === "world" ? "全服聊天" : "私聊记录"}）？`}
          description="该操作不可恢复"
          okText="清理"
          cancelText="取消"
          onConfirm={() => void handleRangeCleanup()}
        >
          <Button danger loading={deleting}>时间范围清理</Button>
        </Popconfirm>
      </Space>

      <Space style={{ marginBottom: 12 }}>
        <Popconfirm
          title={`确认删除选中的 ${selectedRowKeys.length} 条记录？`}
          okText="删除"
          cancelText="取消"
          onConfirm={() => void handleDelete(selectedRowKeys)}
          disabled={selectedRowKeys.length === 0}
        >
          <Button danger disabled={selectedRowKeys.length === 0} loading={deleting}>
            批量删除
          </Button>
        </Popconfirm>
        <Text style={{ color: "#6b6355" }}>
          当前选择 {selectedRowKeys.length} 条
        </Text>
      </Space>

      {tab === "world" ? (
        <Table<WorldMessageRow>
          rowKey="id"
          loading={loading}
          dataSource={activeList as WorldMessageRow[]}
          columns={worldColumns}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map((key) => Number(key))),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            onChange: (nextPage, nextPageSize) => {
              void fetchList({
                page: nextPage,
                pageSize: nextPageSize,
                tab,
                keyword,
                timeRange,
              });
            },
          }}
          scroll={{ x: 1000 }}
        />
      ) : (
        <Table<DmMessageRow>
          rowKey="id"
          loading={loading}
          dataSource={activeList as DmMessageRow[]}
          columns={dmColumns}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys.map((key) => Number(key))),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            onChange: (nextPage, nextPageSize) => {
              void fetchList({
                page: nextPage,
                pageSize: nextPageSize,
                tab,
                keyword,
                timeRange,
              });
            },
          }}
          scroll={{ x: 1100 }}
        />
      )}
    </Card>
  );
}
