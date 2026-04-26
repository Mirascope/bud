import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="coming-soon">
      <h1>Coming Soon</h1>
    </main>
  );
}
