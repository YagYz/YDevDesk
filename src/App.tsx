import { ErrorBoundary } from "./components/ErrorBoundary";
import { DataProvider } from "./context/DataContext";
import Workspace from "./Workspace";

export default function App() {
  return (
    <ErrorBoundary>
      <DataProvider>
        <Workspace />
      </DataProvider>
    </ErrorBoundary>
  );
}
