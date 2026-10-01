import { RemoteCommenter } from "./components";
import { PageLayout } from "@/layouts";

const Dashboard = () => {
  return (
    <PageLayout
      title="Dashboard"
      description="Pluely Twin is local/BYO-provider first. Configure your own AI and speech providers in Dev Space and Audio settings."
    >
      <RemoteCommenter />

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Fork mode</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Local features are unlocked. The historical private Pluely hosted API
          is intentionally disabled in this fork.
        </p>
      </div>
    </PageLayout>
  );
};

export default Dashboard;
