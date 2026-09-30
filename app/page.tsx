import { Studio } from "@/components/studio";
import { loadConnectionOptions } from "@/lib/server/connection-config";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <Studio connectionOptions={await loadConnectionOptions()} />;
}
