import { notFound } from "next/navigation";
import { canAccessAdminEntity } from "@/modules/admin/services/admin-entity-access";
import AdminEntityManager from "@/modules/admin/ui/components/AdminEntityManager";
import SystemConfigManager from "@/modules/admin/ui/components/SystemConfigManager";
import { isAdminEntity } from "@/modules/admin/services/admin-entities";

export default async function AdminEntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;

  if (!isAdminEntity(entity)) {
    notFound();
  }

  const canAccess = await canAccessAdminEntity(entity);
  if (!canAccess) {
    notFound();
  }

  if (entity === "systemConfigs") {
    return <SystemConfigManager />;
  }

  return <AdminEntityManager entity={entity} />;
}
