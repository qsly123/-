import { redirect } from "next/navigation";
import { getCurrentAccount, getCurrentPlayer } from "@/modules/auth/services/auth";

export default async function Home() {
  const account = await getCurrentAccount();
  if (!account) {
    redirect("/login");
  }

  const player = await getCurrentPlayer();
  if (!player) redirect("/select-character");

  redirect("/game/map");
}
