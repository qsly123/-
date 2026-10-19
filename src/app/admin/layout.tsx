import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/modules/auth/services/auth";
import AdminLayoutClient from "@/modules/admin/ui/components/AdminLayoutClient";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    redirect("/game/map");
  }

  return (
    <AdminLayoutClient>
      {children}
    </AdminLayoutClient>
  );
}
