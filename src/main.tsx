import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import App from "./App";
import "./styles.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>MeetLoom</h1>
        <p>Une erreur est survenue. / Something went wrong.</p>
        <button onClick={() => window.location.reload()}>
          Recharger / Reload
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <I18nProvider>
      <App />
    </I18nProvider>
  </ErrorBoundary>,
);
