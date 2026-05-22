import Sidebar from "@/components/layout/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 text-gray-900">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
