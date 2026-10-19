"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { App, Button, Layout, Menu, Space, Typography } from "antd";
import {
  AppstoreOutlined,
  ApartmentOutlined,
  BookOutlined,
  BugOutlined,
  CalendarOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  GiftOutlined,
  HeartOutlined,
  KeyOutlined,
  LogoutOutlined,
  MailOutlined,
  MedicineBoxOutlined,
  MessageOutlined,
  PictureOutlined,
  RadarChartOutlined,
  SettingOutlined,
  StarOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { ADMIN_ENTITY_LABELS } from "@/modules/admin/services/admin-entities";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

type MenuLeafItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  path: string;
};

type MenuGroupItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  children: MenuLeafItem[];
};

const DIRECT_MENU_ITEMS: MenuLeafItem[] = [
  { key: "dashboard", label: "仪表盘", icon: <DashboardOutlined />, path: "/admin/dashboard" },
  { key: "openWorld", label: "开放世界", icon: <EnvironmentOutlined />, path: "/admin/open-world" },
];

const GROUP_MENU_ITEMS: MenuGroupItem[] = [
  {
    key: "worldContent",
    label: "世界内容",
    icon: <EnvironmentOutlined />,
    children: [
      { key: "maps", label: ADMIN_ENTITY_LABELS.maps, icon: <EnvironmentOutlined />, path: "/admin/maps" },
      { key: "temporaryMaps", label: ADMIN_ENTITY_LABELS.temporaryMaps, icon: <EnvironmentOutlined />, path: "/admin/temporaryMaps" },
      { key: "mapEdges", label: ADMIN_ENTITY_LABELS.mapEdges, icon: <EnvironmentOutlined />, path: "/admin/mapEdges" },
      { key: "npcs", label: ADMIN_ENTITY_LABELS.npcs, icon: <TeamOutlined />, path: "/admin/npcs" },
      { key: "monsters", label: ADMIN_ENTITY_LABELS.monsters, icon: <BugOutlined />, path: "/admin/monsters" },
      { key: "temporaryMonsters", label: ADMIN_ENTITY_LABELS.temporaryMonsters, icon: <BugOutlined />, path: "/admin/temporaryMonsters" },
      { key: "quests", label: ADMIN_ENTITY_LABELS.quests, icon: <FileTextOutlined />, path: "/admin/quests" },
      { key: "mainlineGraph", label: "主线编排", icon: <ApartmentOutlined />, path: "/admin/mainline-graph" },
      { key: "randomEvents", label: ADMIN_ENTITY_LABELS.randomEvents, icon: <GiftOutlined />, path: "/admin/randomEvents" },
    ],
  },
  {
    key: "roleAndResource",
    label: "角色与资源",
    icon: <UserOutlined />,
    children: [
      { key: "accounts", label: ADMIN_ENTITY_LABELS.accounts, icon: <UserOutlined />, path: "/admin/accounts" },
      { key: "players", label: ADMIN_ENTITY_LABELS.players, icon: <UserOutlined />, path: "/admin/players" },
      { key: "avatarCosmetics", label: "头像装扮", icon: <PictureOutlined />, path: "/admin/avatar-cosmetics" },
      { key: "items", label: ADMIN_ENTITY_LABELS.items, icon: <AppstoreOutlined />, path: "/admin/items" },
      { key: "aiItems", label: ADMIN_ENTITY_LABELS.aiItems, icon: <AppstoreOutlined />, path: "/admin/aiItems" },
      { key: "pillToxicityConfigs", label: ADMIN_ENTITY_LABELS.pillToxicityConfigs, icon: <MedicineBoxOutlined />, path: "/admin/pillToxicityConfigs" },
      { key: "hongmengTreasures", label: ADMIN_ENTITY_LABELS.hongmengTreasures, icon: <StarOutlined />, path: "/admin/hongmengTreasures" },
      { key: "skills", label: ADMIN_ENTITY_LABELS.skills, icon: <BookOutlined />, path: "/admin/skills" },
      { key: "fortunes", label: ADMIN_ENTITY_LABELS.fortunes, icon: <StarOutlined />, path: "/admin/fortunes" },
      { key: "pregnancyConfig", label: "孕育状态配置", icon: <HeartOutlined />, path: "/admin/pregnancy-config" },
      { key: "realmConfig", label: "境界配置", icon: <SettingOutlined />, path: "/admin/realm-config" },
    ],
  },
  {
    key: "operationTools",
    label: "运营工具",
    icon: <MailOutlined />,
    children: [
      { key: "mailSend", label: "邮件发送", icon: <MailOutlined />, path: "/admin/mail-send" },
      { key: "chatRecords", label: "聊天记录", icon: <MessageOutlined />, path: "/admin/chat-records" },
      { key: "cdkCodes", label: ADMIN_ENTITY_LABELS.cdkCodes, icon: <KeyOutlined />, path: "/admin/cdkCodes" },
      { key: "checkinRewardRules", label: ADMIN_ENTITY_LABELS.checkinRewardRules, icon: <CalendarOutlined />, path: "/admin/checkinRewardRules" },
    ],
  },
  {
    key: "systemAbility",
    label: "系统能力",
    icon: <DatabaseOutlined />,
    children: [
      { key: "systemConfigs", label: ADMIN_ENTITY_LABELS.systemConfigs, icon: <DatabaseOutlined />, path: "/admin/systemConfigs" },
      { key: "gameServer", label: "实时房间监控", icon: <RadarChartOutlined />, path: "/admin/game-server" },
    ],
  },
];

function matchMenuKeyByPath(pathname: string, pathByKey: Record<string, string>) {
  if (pathname === "/admin") {
    return "dashboard";
  }
  const entries = Object.entries(pathByKey)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, path] of entries) {
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      return key;
    }
  }
  return "dashboard";
}

export default function AdminLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { message } = App.useApp();

  const groupMenuItems = useMemo(() => {
    return GROUP_MENU_ITEMS.map((group) => ({
      ...group,
      children: [...group.children],
    })).filter((group) => group.children.length > 0);
  }, []);

  const menuGroupByKey = useMemo(() => {
    return groupMenuItems.reduce((acc, group) => {
      for (const item of group.children) {
        acc[item.key] = group.key;
      }
      return acc;
    }, {} as Record<string, string>);
  }, [groupMenuItems]);

  const pathByMenuKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of DIRECT_MENU_ITEMS) {
      map[item.key] = item.path;
    }
    for (const group of groupMenuItems) {
      for (const item of group.children) {
        map[item.key] = item.path;
      }
    }
    return map;
  }, [groupMenuItems]);

  const labelByMenuKey = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of DIRECT_MENU_ITEMS) {
      map[item.key] = item.label;
    }
    for (const group of groupMenuItems) {
      for (const item of group.children) {
        map[item.key] = item.label;
      }
    }
    return map;
  }, [groupMenuItems]);

  const menuItems = useMemo(() => {
    return [
      ...DIRECT_MENU_ITEMS.map((item) => ({
        key: item.key,
        icon: item.icon,
        label: item.label,
      })),
      ...groupMenuItems.map((group) => ({
        key: group.key,
        icon: group.icon,
        label: group.label,
        children: group.children.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: item.label,
        })),
      })),
    ];
  }, [groupMenuItems]);

  const selectedMenuKey = useMemo(() => {
    return matchMenuKeyByPath(pathname, pathByMenuKey);
  }, [pathname, pathByMenuKey]);

  const activeGroupKey = menuGroupByKey[selectedMenuKey];
  const [manualOpenKeys, setManualOpenKeys] = useState<string[]>([]);
  const openKeys = useMemo(() => {
    if (!activeGroupKey) {
      return manualOpenKeys;
    }
    return manualOpenKeys.includes(activeGroupKey) ? manualOpenKeys : [activeGroupKey, ...manualOpenKeys];
  }, [activeGroupKey, manualOpenKeys]);

  const selectedMenuLabel = useMemo(() => {
    return labelByMenuKey[selectedMenuKey] || "后台管理";
  }, [labelByMenuKey, selectedMenuKey]);

  async function handleLogout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const result = await response.json();
      if (result.success) {
        router.push("/login");
      } else {
        message.error(result.error || "退出失败");
      }
    } catch {
      message.error("退出失败");
    }
  }

  return (
    <Layout style={{ height: "100vh", background: "#0d0d0f", overflow: "hidden" }}>
      <Sider
        width={220}
        style={{
          borderRight: "1px solid #2a2520",
          background: "#0d0d0f",
          height: "100vh",
          maxHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderBottom: "1px solid #2a2520",
              flex: "0 0 64px",
            }}
          >
            <Text style={{ color: "#c9a84c", fontSize: 18, fontWeight: 600 }}>后台管理</Text>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[selectedMenuKey]}
            openKeys={openKeys}
            style={{
              borderRight: 0,
              paddingTop: 8,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              overflowX: "hidden",
            }}
            items={menuItems}
            onOpenChange={(keys) => setManualOpenKeys(keys as string[])}
            onClick={(info) => {
              const key = String(info.key || "");
              const path = pathByMenuKey[key];
              if (path) {
                router.push(path);
              }
            }}
          />
        </div>
      </Sider>

      <Layout
        style={{
          height: "100vh",
          maxHeight: "100vh",
          overflow: "hidden",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Header
          style={{
            height: 64,
            padding: "0 20px",
            borderBottom: "1px solid #2a2520",
            background: "#0d0d0f",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flex: "0 0 64px",
          }}
        >
          <Space>
            <Text style={{ color: "#c9a84c", fontSize: 18, fontWeight: 500 }}>
              {selectedMenuLabel}
            </Text>
          </Space>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>
            退出登录
          </Button>
        </Header>

        <Content
          style={{
            padding: 20,
            overflow: "auto",
            flex: 1,
            minHeight: 0,
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
